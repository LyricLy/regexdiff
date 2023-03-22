window.resize = function(element) {
    element.style.height = "1px";
    element.style.padding = "0px";
    element.style.height = element.scrollHeight + "px";
    element.style.padding = null;
}

window.stopEnter = function(event) {
    if (event.which === 13) {
        event.preventDefault();
    }
}

window.deNewline = function(event) {
    event.preventDefault();
    const sel = window.getSelection();
    sel.deleteFromDocument();
    sel.getRangeAt(0).insertNode(document.createTextNode(event.clipboardData.getData("text/plain").replace(/\n/g, "")));
    sel.collapseToEnd();
}

window.falseBox = function(event) {
    event.preventDefault();
}

const pattern = document.getElementById("pattern");
const input = document.getElementById("input");
const output = document.getElementById("output");
const inputOutput = document.getElementById("input-output");
const errors = document.getElementById("errors");

function render(s) {
    return [...s].map(x => x === "\n" ? "↵\n" : x).join("")
}

function addSpan(node, text, klass) {
    const span = document.createElement('span');
    span.setAttribute("class", klass);
    span.textContent = klass ? render(text) : text;
    node.appendChild(span);
}

let worker = null;
window.touch = function() {
    const regex = pattern.innerText.replace(/\n$/m, "");
    const start = input.innerText.replace(/\n$/m, "");
    if (worker) worker.terminate();
    worker = new Worker("dist/bundle.js");
    worker.onmessage = (e) => {
        worker.done = true;
        if (typeof e.data === "string") {
            errors.textContent = e.data;
            output.textContent = ":(";
            resize(output);
        } else {
            errors.textContent = "";
            displayDiff(start, e.data);
        }
    };
    worker.postMessage({regex, start});
    setTimeout(() => {
        if (!worker.done) {
            errors.textContent = "";
            inputOutput.innerText = start;
            resize(inputOutput);
        }
    }, 100);
    setTimeout(() => {
        if (!worker.done) {
            output.textContent = "...";
            resize(output);
        }
    }, 500);
}

function displayDiff(start, diff) {
    inputOutput.textContent = "";
    output.textContent = "";
    let i = 0;
    for (const move of diff) {
        switch (move.type) {
          case "keep":
            addSpan(inputOutput, start[i], "");
            addSpan(output, start[i], "");
            i++;
            break;
          case "replace":
            addSpan(inputOutput, start[i], "replace");
            addSpan(output, move.what, "replace");
            i++;
            break;
          case "delete":
            addSpan(inputOutput, start[i], "delete");
            i++;
            break;
          case "insert":
            addSpan(output, move.what, "insert");
            break;
        }
    }
    resize(inputOutput);
    resize(output);
}
