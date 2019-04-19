#!/usr/bin/env node

const fs = require('fs');
const path = require('path')
const request = require('./request');

// Get arguments
let [,,cmd, ... files] = process.argv;

// Get the current dir
const dir = process.cwd();

switch (cmd) {

  case 'push':

    files == [] ? ['package.json'] : files;

    // Read package.json
    let mesa = fs.readFileSync(`${dir}/package.json`, 'utf8');
    if (!mesa) {
      console.log('Could not find package.json...');
      return;
    }
    mesa = JSON.parse(mesa);

    files.forEach(function(filename) {

      const filepath = `${dir}/${filename}`;
      const extension = path.extname(filename);

      if (extension === '.md' || extension === '.js') {

        // Handle appending a path from mesa.json directories param
        let mesaFilename = filename;
        if (!mesa || !mesa.directories || !mesa.directories.lib) {
          console.log(`Uploading ${filename}...`);
        }
        else {
          mesaFilename = `${mesa.directories.lib}/${filename}`;
          console.log(`Uploading ${filename} as ${mesaFilename}...`);
        }

        const contents = fs.readFileSync(filepath, 'utf8');
        request('POST', 'scripts.json', {
          script: {
            filename: mesaFilename,
            code: contents
          }
        });
      }
      else if (filename === 'package.json') {
        console.log('Importing configuration from package.json...');
        request('POST', 'packages/import.json?force=1', mesa);
      }
      else {
        console.log(`Skipping ${filename}`);
      }

    });
    break;


  case 'watch':

    // var windows = process.platform === 'win32'
    // var pathVarName = (windows && !('PATH' in process.env)) ? 'Path' : 'PATH'
    //
    // process.env[pathVarName] += path.delimiter + path.join(__dirname, 'node_modules', '.bin');
    // cmd = system(`npm-watch `)


    // var watchPackage = require('./watch-package')
    // var watcher = watchPackage(process.argv[3] || process.cwd(), process.exit, process.argv[2])
    //

    var windows = process.platform === 'win32'
    var pathVarName = (windows && !('PATH' in process.env)) ? 'Path' : 'PATH'

    process.env[pathVarName] += path.delimiter + path.join(__dirname, 'node_modules', '.bin')

    var watchPackage = require('./watch-package')
    var watcher = watchPackage(process.argv[3] || process.cwd(), process.exit, process.argv[2])

    process.stdin.pipe(watcher)
    watcher.stdout.pipe(process.stdout)
    watcher.stderr.pipe(process.stderr)

    //
    //
    //
    // npm-watch push


}

