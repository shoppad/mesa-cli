#!/usr/bin/env node
const program = require('commander');
const fs = require('fs');
const path = require('path')
const axios = require("axios");
const sh = require("shelljs");

let apiUrl = 'https://api.getmesa.com/v1/admin';

// Get the current dir
const dir = sh.pwd().stdout;


// Get arguments and options
function list(val) {
  return val.split(',');
}
program
  .version('0.1.0')
  .usage('[options] <file ...>')
  .option('-e, --env [value]', 'Environment to use (filename in `./config/`)')
  .option('-i, --inputs <list>', 'Comma-separated list of inputs', list)
  .option('-o, --outputs <list>', 'Comma-separated list of outputs', list)
  .option('-s, --secrets <list>', 'Comma-separated list of secrets', list)
  .option('--storage <list>', 'Comma-separated list of storage items', list)
  .option('--files <list>', 'Comma-separated list of filenames, including paths', list)
  .option('-f, --force', 'Force')
  .parse(process.argv);

let [cmd, ... files] = program.args;

// Load config from config.yml
let env = program.env ? program.env : null;
env = process.env.ENV ? process.env.ENV : env;
let config;
try {
  config = require('config-yml').load(env);
  console.log('Loaded shop config from local config')
}
catch (e) {
  try {
    process.chdir(`${process.env.HOME}/.mesa`);
    config = require('config-yml').load(env);
    process.chdir(dir);
    console.log('Loaded shop config from global config in ~/.mesa')
  } catch (e) {
    console.log(e);
    const configFile = env ? env : 'config';
    return console.log(`Could not find an appropriate ${configFile}.yml file. Exiting.`);
  }
}
if (!config.uuid) {
  return console.log('UUID not specified in config.yml. Exiting.');
}

// const dir = process.env.INIT_CWD;
console.log(`Working directory: ${dir}`);
console.log(`Store: ${config.uuid}.myshopify.com`);
console.log('');

// Read mesa.json
let mesa;
try {
  mesa = fs.readFileSync(`${dir}/mesa.json`, 'utf8');
  mesa = JSON.parse(mesa);
}
catch (e) {
  //return console.log('Could not find mesa.json. Exiting.');
}

switch (cmd) {

  case 'push':

    files == [] ? ['mesa.json'] : files;

    files.forEach(function(filename) {

      const filepath = `${dir}/${filename}`;
      console.log(filepath);
      upload(filepath);

    });
    break;


  case 'watch':

    var watch = require('watch');

    watch.watchTree(dir, {
      filter: function (filename) {
        // Exclude node_modules, only look for .js and .md files
        return filename.indexOf(/node_modules|.git/) === -1;
      },
    }, function (filepath, curr, prev) {

      // Ignore the initial index of all files
      if (typeof filepath === 'object') {
        return;
      }
      console.log(filepath);
      if (filepath.indexOf('.js')) {
        upload(filepath);
      }
    })
    break;


  // case 'initialize':
  //
  //   // Get mesa.json
  //   request('POST', 'packages/export.json', {
  //     "inputs": program.inputs,
  //     "outputs": program.outputs,
  //     "secrets": program.secrets,
  //     "storage": program.storage,
  //     "files": program.files
  //   }, function(response, data) {
  //
  //     mesa = require('./mesaModel');
  //
  //     if (response.config) {
  //       mesa.config = response.config;
  //
  //       mesa.files = program.files && program.files.length ? program.files : undefined;
  //       // if (program.directory) {
  //       //   mesa.directories = {
  //       //     lib: program.directory
  //       //   }
  //       // }
  //
  //       const strMesa = JSON.stringify(mesa, null, 2);
  //       console.log('Writing configuration to mesa.json:');
  //       console.log(strMesa);
  //       fs.writeFileSync('mesa.json', strMesa);
  //     }
  //
  //     if (program.files && program.files.length) {
  //       download(program.files);
  //     }
  //
  //
  //   });
  //   break;

  case 'pull':

    download(files);
    break;

  case 'initialize':

    // Get mesa.json
    request('POST', 'packages/export.json', {
      "inputs": program.inputs,
      "outputs": program.outputs,
      "secrets": program.secrets,
      "storage": program.storage,
      "files": program.files
    }, function(response, data) {

      mesa = require('./mesaModel');

      if (response.config) {
        mesa.config = response.config;

        mesa.files = program.files && program.files.length ? program.files : undefined;
        // if (program.directory) {
        //   mesa.directories = {
        //     lib: program.directory
        //   }
        // }

        const strMesa = JSON.stringify(mesa, null, 2);
        console.log('Writing configuration to mesa.json:');
        console.log(strMesa);
        fs.writeFileSync('mesa.json', strMesa);
      }

      if (program.files && program.files.length) {
        download(program.files);
      }


    });
    break;

  case 'install':
    // In this instance, `files` is the package name
    if (files == []) {
      return console.log('ERROR', 'No package specified');
    }

    files.forEach(function(package) {
      request('POST', `packages/install.json`, {
        package: package
      });
    });
    break;

  case 'replay':
    // In this instance, `files` is the task id
    if (files == []) {
      return console.log('ERROR', 'No Task ID specified');
    }

    files.forEach(function(taskId) {
      request('POST', `task/${taskId}/replay.json`);
    });
    break;

  case 'logs':
    const response = request('GET', `logs.json`, {}, function(data) {
      data.logs.forEach(item => {
        const date = new Date(item['@timestamp']);
        const dateString = date.toLocaleDateString("en-US") + ' ' + date.toLocaleTimeString("en-US");
        console.log(`[${dateString}] [${item.trigger.name}] [${item.trigger._id}] ${item.message}`);
      });
    });
    break;

  default:
    console.log('mesa push [params] <files>');
    console.log('mesa pull [params] <files>');
    console.log('mesa watch');
    console.log('mesa install <package> [version]');
    console.log('mesa replay <task_id>');
    console.log('mesa logs');
    console.log('mesa initialize --inputs=[csv] --outputs=[csv] --secrets=[csv] --storage=[csv] --files=[csv]');
    console.log('');
    console.log('Optional Parameters:');
    console.log('  -e, --env [value] : Environment to use (filename in `./config/`)');
    console.log('  -f, --force : Force');
    console.log('');
}

/**Skipping
 *
 * @param {string} filepath
 */
function upload(filepath) {

  const filename = filepath.replace(`${dir}/`, '');
  const extension = path.extname(filename);
  const contents = fs.readFileSync(filepath, 'utf8');

  // @todo: do we want to allow uploading of .md files? if (extension === '.md' || extension === '.js') {
  if (extension === '.js') {
    console.log(`Uploading ${filename} as ${filename}...`);

    request('POST', 'scripts.json', {
      script: {
        filename: filename,
        code: contents
      }
    });
  }
  else if (filename === 'mesa.json') {
    if (!contents.config) {
      return console.log('Mesa.json did not contain any config elements. Skipping.');
    }
    console.log('Importing configuration from mesa.json...');
    const force = program.force ? '?force=1': '';
    request('POST', `packages/import.json${force}`, contents);
  }
  else {
    console.log(`Skipping ${filename}`);
  }

}


/**
 * Download and save files via the Mesa Scripts API.
 *
 * @param {array} files
 */
function download(files) {
  // Get all scripts
  request('GET', 'scripts.json', {}, function(response) {
    files.forEach(function(file) {
      response.scripts.forEach(function(item) {

        if (item.filename == file || item.filename.indexOf(file) !== -1) {

          filename = !mesa || !mesa.directories || !mesa.directories.lib ?
            item.filename :
            item.filename.replace(`${mesa.directories.lib}/`, '');

          createDirectories(filename);

          console.log(`Saving ${filename}...`);
          fs.writeFileSync(filename, item.code);
        }
      });
    });
  });

}

/**
 * Recursively create directories
 *
 * @param {string} filename
 */
function createDirectories(filename) {
  const dir = path.dirname(filename);
  if (dir && !fs.existsSync(dir)) {
    console.log(`Creating directory: ${dir}...`);
    fs.mkdirSync(dir, { recursive: true });
  }
}


/**
 * Call the Mesa API.
 *
 * @param {string} method
 * @param {string} endpoint
 * @param {object} data
 * @param {function} cb
 */
function request(method, endpoint, data, cb){

  // Let the api url be overwritten in config.yml
  apiUrl = config.api_url ? config.api_url : apiUrl;

  const options = {
    url: `${apiUrl}/${config.uuid}/${endpoint}`,
    method: method,
    headers: { 'x-api-key': config.key },
    json: true,
  };
  if (method !== 'GET' && data) {
    options.data = data;
  }

  axios(options)
    .then(function (response) {
      if (cb) {
        cb(response.data);
      }
      console.log(`Success: ${options.method} ${options.url}`);
    })
    .catch(function (error) {
      //console.log(error.response.data);
      const msg = error.response && error.response.data ? error.response.data : error;
      // const msg = error.response && error.response.status ? `${error.response.status}: ${error.response.statusText}` : error;
      console.log('ERROR', options, msg);
    });


}
