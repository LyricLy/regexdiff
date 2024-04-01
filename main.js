import {EditorView, minimalSetup} from "codemirror";
import {Decoration} from "@codemirror/view";
import {StateField, StateEffect} from "@codemirror/state";

const markField = StateField.define({
    create() {
        return Decoration.none;
    },
    update(marks, tr) {
        for (const e of tr.effects) {
            if (e.is(markSpan)) {
                marks = Decoration.set(e.value);
            }
        }
        return marks;
    },
    provide: f => EditorView.decorations.from(f),
});

const baseExtensions = [
    minimalSetup,
    EditorView.updateListener.of((v) => {
        if (v.docChanged) touch();
    }),
];

const patternParent = document.getElementById("pattern-parent");
const pattern = new EditorView({
    extensions: baseExtensions,
    parent: patternParent,
});

const inputParent = document.getElementById("input-parent");
const input = new EditorView({
    extensions: [...baseExtensions, markField],
    parent: inputParent,
});

const outputParent = document.getElementById("output-parent");
const output = new EditorView({
    extensions: [EditorView.editable.of(false), markField],
    parent: outputParent,
})

const errors = document.getElementById("errors");

const anchored = document.getElementById("anchored");
const lazy = document.getElementById("lazy");
const cg = window.location.search === "?cg";

if (cg) {
    patternParent.insertAdjacentHTML("beforebegin", "welcome from code guessing! you can edit the url to remove this state");
    for (let i = 0; i < 5; i++) anchored.nextSibling.nextSibling.remove();
    anchored.remove();
    inputParent.remove();
    outputParent.children[0].innerHTML = "result";
}

for (const elem of [anchored, lazy]) {
    elem.addEventListener("change", touch);
}

let worker = null;
function touch() {
    const regex = pattern.state.doc.toString();
    const string = input.state.doc.toString();
    if (worker) worker.terminate();
    worker = new Worker(new URL("worker.js", import.meta.url), {type: "module"});
    worker.onmessage = (e) => {
        worker.done = true;
        if (typeof e.data === "string") {
            errors.textContent = e.data;
            setOutput(":(");
        } else {
            errors.textContent = "";
            displayDiff(string, e.data);
        }
    };
    worker.postMessage({regex, string, anchored: anchored.checked, lazy: lazy.checked, cg});
    setTimeout(() => {
        if (!worker.done) {
            errors.textContent = "";
            setOutput("...");
        }
    }, 500);
}

const markSpan = StateEffect.define();

const insertMark = Decoration.mark({class: "insert"});
const deleteMark = Decoration.mark({class: "delete"});

function setOutput(text, marks) {
    output.dispatch({
        effects: [markSpan.of(marks ?? [])],
        changes: {
            from: 0,
            to: output.state.doc.length,
            insert: text,
        }
    });
}

function displayDiff(start, diff) {
    let i = 0;
    let out = "";
    const inputMarks = [];
    const outputMarks = [];
    for (const move of diff) {
        switch (move.type) {
          case "keep":
            out += start[i];
            i++;
            break;
          case "delete":
            inputMarks.push(deleteMark.range(i, i+1));
            i++;
            break;
          case "insert":
            outputMarks.push(insertMark.range(out.length, out.length+move.what.length));
            out += move.what;
            break;
        }
    }
    input.dispatch({effects: [markSpan.of(inputMarks)]});
    setOutput(out, outputMarks);
}
