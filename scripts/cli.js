#!/usr/bin/env node
var program = require('commander');
const fs = require('fs');
const path = require('path')
var axios = require("axios");

let apiUrl = 'https://api.getmesa.com/dev/admin';


// Get arguments and options
program
  .version('0.1.0')
  .usage('[options] <file ...>')
  .option('-e, --env [myVar]', 'Environment to use (filename in `./config/`)')
  .option('-f, --force', 'Force')
  .parse(process.argv);

let [cmd, ... files] = program.args;

// Load config from config.yml
let env = program.env ? program.env : null;
env = process.env.ENV ? process.env.ENV : env;
const config = require('config-yml').load(env);
if (!config.key) {
  const configFile = program.env ? program.env : 'config';
  return console.log(`Could not find an appropriate ${configFile}.yml file. Exiting.`);
}

// Get the current dir
const dir = process.env.INIT_CWD;
console.log(`Working directory: ${dir}`);
console.log(`Store: ${config.uuid}.myshopify.com`);
console.log('');

switch (cmd) {

  case 'push':

    files == [] ? ['mesa.json'] : files;

    // Read mesa.json
    let mesa;
    try {
      mesa = fs.readFileSync(`${dir}/mesa.json`, 'utf8');
      mesa = JSON.parse(mesa);
    }
    catch (e) {
      //return console.log('Could not find mesa.json. Exiting.');
    }

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
      else if (filename === 'mesa.json') {
        if (!mesa.config) {
          return console.log('Mesa.json did not contain any config elements. Skipping.');
        }
        console.log('Importing configuration from mesa.json...');
        const force = program.force ? '?force=1': '';
        request('POST', `packages/import.json${force}`, mesa);
      }
      else {
        console.log(`Skipping ${filename}`);
      }

    });
    break;


  // case 'watch':
  //
  //   // var windows = process.platform === 'win32'
  //   // var pathVarName = (windows && !('PATH' in process.env)) ? 'Path' : 'PATH'
  //   //
  //   // process.env[pathVarName] += path.delimiter + path.join(__dirname, 'node_modules', '.bin');
  //   // cmd = system(`npm-watch `)
  //
  //
  //   // var watchPackage = require('./watch-package')
  //   // var watcher = watchPackage(process.argv[3] || process.cwd(), process.exit, process.argv[2])
  //   //
  //
  //   var windows = process.platform === 'win32'
  //   var pathVarName = (windows && !('PATH' in process.env)) ? 'Path' : 'PATH'
  //
  //   process.env[pathVarName] += path.delimiter + path.join(__dirname, 'node_modules', '.bin')
  //
  //   var watchPackage = require('./watch-package')
  //   var watcher = watchPackage(process.argv[3] || process.cwd(), process.exit, process.argv[2])
  //
  //   process.stdin.pipe(watcher)
  //   watcher.stdout.pipe(process.stdout)
  //   watcher.stderr

}


async function request(method, endpoint, data){

  // Let the api url be overwritten in config.yml
  apiUrl = config.api_url ? config.api_url : apiUrl;

  const options = {
    url: `${apiUrl}/${config.uuid}/${endpoint}`,
    method: method,
    headers: { 'x-api-key': config.key },
    data: data,
    json: true,
  };

  axios(options)
    .then(function (response) {
      if (endpoint.indexOf('packages') !== -1) {
        console.log('Response: ', response.data);
      }
      else {
        console.log('Success');
      }
    })
    .catch(function (error) {
      console.log(error);
      console.log('ERROR', `${error.response.status}: ${error.response.statusText}`);
    });


}
