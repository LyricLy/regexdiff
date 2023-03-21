const diffFor = require("./diff.js");

self.onmessage = function(e) {
    try {
        postMessage(diffFor(e.data.regex, e.data.start));
    } catch (error) {
        postMessage(error.message);
    }
}
