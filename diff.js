import re from "regexp-tree";

function addClass(expr, s) {
    if (expr.codePoint) {
        s.add(expr.symbol);
        return;
    }
    const r = new RegExp(re.generate(expr), "us");
    for (const c of s) {
        if (r.test(c)) return;
    }
    // be picky
    for (const cand of ["x", "#", "0", " "]) {
        if (r.test(cand)) {
            s.add(cand);
            return;
        }
    }
    // be less picky
    for (let i = 33; i <= 0xE01EF; i++) {
        const cand = String.fromCodePoint(i);
        if (r.test(cand) && /\P{C}/u.test(cand)) {
            s.add(cand);
            return;
        }
    }
    // don't be picky
    for (let i = 0; i < 0x10FFFF; i++) {
        const cand = String.fromCodePoint(i);
        if (r.test(cand)) {
            s.add(cand);
            return;
        }
    }
    // we can give up here since [^\0-\u{10ffff}] is []
}

function charset(expr, string) {
    const s = new Set(string);
    re.traverse(expr, {
        Char({node}) {
            addClass(node, s);
        },
        CharacterClass({node}) {
            addClass(node, s);
            return false;
        },
        Assertion({node}) {
            if (node.kind === '\\b') s.add(' ');
        },
    });
    return s;
}

function parse(string) {
    return re.parse(new RegExp([...string].map(x => x.length === 1 ? x : `\\u{${x.codePointAt(0).toString(16)}}`).join(''), 'us')).body;
}

let id = 0;
function empty() {
    return {back: [], forward: [], id: id++};
}

function idNfa() {
    const idNode = empty();
    return {start: idNode, end: idNode};
}

function nfaClass(expr, charset) {
    const r = new RegExp(re.generate(expr), "us");
    const start = empty();
    const end = empty();
    for (const c of charset) {
        if (r.test(c)) {
            edge(start, end, c);
        }
    }
    return {start, end};
}

function nfaAppend(nfa, other) {
    for (const x of other.start.forward) {
        x.from = nfa.end;
    }
    nfa.end.forward = other.start.forward;
    nfa.end = other.end;
}

function nfaClone(nfa) {
    const s = blankSlate();
    const start = idGet(s, nfa.start);
    while (s.frontier.length) {
        const state = s.frontier.pop();
        const us = idGet(s, state);
        for (const transition of state.forward) {
            edge(us, idGet(s, transition.to), transition.at, transition.assert);
        }
    }
    return {start, end: idGet(s, nfa.end)};
}

function edge(x, y, at, assert, rev) {
    if (rev) [x, y] = [y, x];
    const transition = {at, assert, from: x, to: y};
    x.forward.push(transition);
    y.back.push(transition);
}

function toNfa(expr, charset) {
    re.traverse(expr, {
        Char({node}) {
            node.nfa = nfaClass(node, charset);
        },
        CharacterClass({node}) {
            node.nfa = nfaClass(node, charset);
            return false;
        },
        Group: {post: ({node}) => {
            node.nfa = node.expression?.nfa ?? idNfa();
        }},
        Alternative: {post: ({node}) => {
            const nfa = idNfa();
            for (const child of node.expressions) {
                nfaAppend(nfa, child.nfa);
            }
            node.nfa = nfa;
        }},
        Disjunction: {post: ({node}) => {
            const start = empty();
            edge(start, node.left.nfa.start);
            edge(start, node.right.nfa.start);
            const end = empty();
            edge(node.left.nfa.end, end);
            edge(node.right.nfa.end, end);
            node.nfa = {start, end};
        }},
        Repetition: {post: ({node}) => {
            let from;
            let to;
            switch (node.quantifier.kind) {
              case '*':
                from = 0;
                to = undefined;
                break;
              case '?':
                from = 0;
                to = 1;
                break;
              case '+':
                from = 1;
                to = undefined;
                break;
              case 'Range':
                from = node.quantifier.from;
                to = node.quantifier.to;
                break;
            }
            const source = node.expression.nfa;
            const nfa = idNfa();
            for (let i = 0; i < from; i++) {
                nfaAppend(nfa, nfaClone(source));
            }
            if (to !== undefined) {
                const ends = [];
                for (let i = from; i < to; i++) {
                    ends.push(nfa.end);
                    nfaAppend(nfa, nfaClone(source));
                }
                for (const end of ends) {
                    edge(end, nfa.end);
                }
            } else {
                edge(source.end, source.start);
                const start = empty();
                const end = empty();
                edge(start, end);
                edge(start, source.start);
                edge(source.end, end);
                nfaAppend(nfa, {start, end});
            }
            node.nfa = nfa;
        }},
        Assertion({node}) {
            const start = empty();
            const end = empty();
            let rev;
            switch (node.kind) {
              case 'Lookbehind':
                rev = true;
                break;
              case 'Lookahead':
                rev = false;
                break;
              case '^':
                node.nfa = toNfa(parse("(?<!.)"), charset);
                return;
              case '$':
                node.nfa = toNfa(parse("(?!.)"), charset);
                return;
              case '\\b':
                node.nfa = toNfa(parse(/((?<=\w|(?<!.))(?=\W|(?!.))|(?<=\W|(?<!.))(?=\w|(?!.)))/.source), charset);
                return;
              default:
                throw SyntaxError(`Unsupported assertion: ${node.kind}`);
            }
            let body;
            if (!node.assertion) {
                body = compile(parse('.*'), charset);
            } else if (rev) {
                body = toDfaRev(dfaToNfa(compile({type: 'Alternative', expressions: [parse('.*'), node.assertion]}, charset)));
            } else {
                body = compile({type: 'Alternative', expressions: [node.assertion, parse('.*')]}, charset);
            };
            if (node.negative) body = negate(body, charset);
            edge(start, end, undefined, {rev, body});
            node.nfa = {start, end};
            return false;
        },
    });
    return expr.nfa;
}

function blankSlate() {
    return {states: new Map(), frontier: []};
}

function getState(keyFn, emptyFn, {states, frontier}, p) {
    const key = keyFn(p);
    const state = states.get(key);
    if (state !== undefined) return state;
    frontier.push(p);
    const newState = emptyFn();
    states.set(key, newState);
    return newState;
}

function begin(x, rev) {
    return rev ? x.end : x.start;
}

function final(x, rev) {
    return rev ? x.start : x.end;
}

function edges(x, rev) {
    const l = rev ? x.back.flatMap(({at, assert, from}) => from ? [{at, assert, to: from}] : []) : x.forward.flatMap(({at, assert, to}) => to ? [{at, assert, to}] : []);
    return l;
}

function over(x, y, rev) {
    return rev ? {start: y, end: x} : {start: x, end: y};
}

const key = (x, y) => `${x},${y}`;
const biGet = (s, p) => getState(({a, b}) => key(a.id, [...b].sort()), empty, s, p);

function intersect(x, rev) {
    const s = blankSlate();
    const start = biGet(s, {a: begin(x, rev), b: new Set()});
    const aEnd = final(x, rev);
    const ends = [];
    const edgeMap = new Map();
    const accept = new Set();
    while (s.frontier.length) {
        const {a, b} = s.frontier.pop();
        const us = biGet(s, {a, b});
        if (a === aEnd && [...b].every(x => accept.has(x))) {
            ends.push(us);
        }
        edgeSearch: for (const aEdge of edges(a, rev)) {
            if (!aEdge.at) {
                let assert = aEdge.assert;
                let newB = b;
                if (assert && assert.rev === rev) {
                    const body = assert.body;
                    assert = undefined;
                    newB = new Set(b);
                    if (!edgeMap.has(body.initial)) {
                        for (const [k, v] of body.edges) edgeMap.set(k, v);
                        for (const v of body.accept) accept.add(v);
                    }
                    newB.add(body.initial);
                }
                edge(us, biGet(s, {a: aEdge.to, b: newB}), undefined, assert, rev);
            } else {
                const newB = new Set();
                for (const state of b) {
                    const to = edgeMap.get(state).get(aEdge.at);
                    if (to === undefined) continue edgeSearch;
                    newB.add(to);
                }
                edge(us, biGet(s, {a: aEdge.to, b: newB}), aEdge.at, undefined, rev);
            }
        }
    }
    let end = empty();
    for (const state of ends) {
        edge(state, end, undefined, undefined, rev);
    }
    return over(start, end, rev);
}

let n = 0;
function newState(dfa) {
    dfa.edges.set(n, new Map());
    return n++;
}

function draw(dfa, x, y, at) {
    dfa.edges.get(x).set(at, y);
}

function goodKey(x) {
    return [...x].map(e => e.id).sort().join();
}

function toDfaRev(nfa) {
    const dfa = {accept: new Set(), edges: new Map()};
    const joinGet = (s, p) => getState(goodKey, () => newState(dfa), s, p);
    const s = blankSlate();
    dfa.initial = joinGet(s, new Set([begin(nfa, true)]));
    const end = final(nfa, true);
    while (s.frontier.length) {
        const da = s.frontier.pop();
        const mada = [...da];
        const edge = new Map();
        while (mada.length) {
            const code = mada.pop();
            if (code === end) {
                dfa.accept.add(joinGet(s, da));
            }
            for (const corn of edges(code, true)) {
                if (!corn.at) {
                    mada.push(corn.to);
                } else {
                    let e = edge.get(corn.at);
                    if (!e) {
                        e = new Set();
                        edge.set(corn.at, e);
                    }
                    e.add(corn.to);
                }
            }
        }
        for (const [k, v] of edge) {
            draw(dfa, joinGet(s, da), joinGet(s, v), k);
        }
    }
    return dfa;
}

const idGet = (s, p) => getState(x => x, empty, s, p);

function dfaToNfa(dfa) {
    const s = blankSlate();
    const start = idGet(s, dfa.initial);
    const end = empty();
    while (s.frontier.length) {
        const state = s.frontier.pop();
        const us = idGet(s, state);
        if (dfa.accept.has(state)) {
            edge(us, end);
        }
        for (const [k, v] of dfa.edges.get(state)) {
            edge(us, idGet(s, v), k);
        }
    }
    return {start, end};
}

function negate(dfa, charset) {
    const acceptSink = newState(dfa);
    for (const c of charset) {
        draw(dfa, acceptSink, acceptSink, c);
    }
    const newAccept = new Set();
    for (const [state, edges] of dfa.edges) {
        for (const c of charset) {
            if (!edges.has(c)) edges.set(c, acceptSink);
        }
        if (!dfa.accept.has(state)) newAccept.add(state);
    } 
    dfa.accept = newAccept;
    return dfa;
}

function compile(expr, charset) {
    return toDfaRev(dfaToNfa(toDfaRev(intersect(intersect(toNfa(expr, charset), false), true))));
}

function compileFor(expr, string) {
    const dfa = compile(expr, charset(expr, string));
    if (!dfa.accept.size) throw Error("expression cannot match anything. see about page for more info");
    return dfa;
}

function allPairsShortestPath(edges) {
    const paths = new Map();
    for (const [k, v] of edges) {
        const subpaths = new Map();
        for (const [c, t] of v) {
            subpaths.set(t, c);
        }
        subpaths.set(k, "");
        paths.set(k, subpaths);
    }
    for (const a of edges.keys()) {
        for (const b of edges.keys()) {
            for (const c of edges.keys()) {
                const x = paths.get(b)?.get(a);
                const y = paths.get(a)?.get(c);
                const np = x !== undefined && y !== undefined ? x + y : undefined;
                if ((paths.get(b)?.get(c)?.length ?? Infinity) > np?.length) paths.get(b).set(c, np);
            }
        }
    }
    return paths;
}

function improve(table, i, state, entry) {
    const k = key(i+1, state);
    const current = table.get(k);
    if (!current || current.cost > entry.cost) table.set(k, entry);
}

function maybeInsert(path, stost) {
    const {steps, cost} = stost ?? {steps: [], cost: 0};
    return path ? {steps: [...steps, {type: "insert", what: path}], cost: cost + path.length + 1} : {steps, cost};
}

function diff(dfa, string) {
    const shortest = allPairsShortestPath(dfa.edges);
    const table = new Map();
    for (let i = 0; i < string.length; i++) {
        for (const state of i === 0 ? [dfa.initial] : dfa.edges.keys()) {
            const stost = table.get(key(i, state));
            for (const [target, path] of shortest.get(state)) {
                const {steps, cost} = maybeInsert(path, stost);
                improve(table, i, target, {steps: [...steps, {type: "delete"}], cost: cost + 1});
                for (const [k, v] of dfa.edges.get(target)) {
                    if (k === string[i]) improve(table, i, v, {steps: [...steps, {type: "keep"}], cost: cost});
                }
            }
        }
    }
    let best = null;
    for (const state of !string ? [dfa.initial] : dfa.edges.keys()) {
        for (const accepting of dfa.accept) {
            const path = shortest.get(state).get(accepting);
            if (path === undefined) continue;
            const stost = maybeInsert(path, table.get(key(string.length, state)));
            if (!best || stost.cost < best.cost) best = stost;
        }
    }
    return best.steps;
}

export default function diffFor(regex, string) {
    return diff(compileFor(parse(regex), string), string);
}
