import diffFor from "./diff.js";

self.onmessage = function({data}) {
    try {
        postMessage(diffFor(data));
    } catch (error) {
        postMessage(error.message);
    }
}
