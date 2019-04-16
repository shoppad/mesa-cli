const fs = require('fs');
const request = require('./request');

const filename = process.argv[2];
const contents = fs.readFileSync(filename, 'utf8');

console.log(`Uploading ${filename}...`);
request('POST', {
  script: {
    filename: filename,
    code: contents
  }
});
