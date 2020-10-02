#!/usr/bin/env node
const program = require('commander');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sh = require('shelljs');

let apiUrl = 'https://api.getmesa.com/v1/admin';

// Get the current dir
const dir = sh.pwd().stdout;

// Get arguments and options
function list(val) {
  return val.split(',');
}
program
  .usage('[options] <file ...>')
  .option('--output [value]', 'Folder to save to. Defaults to ../fields/')
  .option('--print', 'console.log() the result instead of saving to a file')
  .option('--importance [value]', 'Automatically set the importance on all fields. Defaults to undefined.')
  .option('--required [value]', 'Automatically set the required value for all fields. Defaults to false.')
  .option('--allowcustom [value], --force', 'Set allow_custom_fields on objects/arrays. Defaults to true.')
  .parse(process.argv);

let [...files] = program.args;
let {output, print, importance, required, allowcustom} = program;
output = output || '../fields/';
required = required !== undefined ? (required === 'true' ? true : false) : false;
importance = importance !== undefined ? parseInt(importance) : undefined;
allowcustom = allowcustom !== undefined ? (allowcustom === 'true' ? true : false) : true;

if (!files.length || files[0] === 'help') {
  console.log(program.options);
  process.exit();
}

const detectProvides = (key) => {

  const provides = {
    barcode: 'product_barcode',
    sku:'product_sku',
    product_type:'product_type',
    vendor:'product_vendor',
    tags:'tags',
    email:'email',
    'first_name|fname|firstname':'first_name',
    'last_name|lname|lastname':'last_name',
    'full_name|name':'full_name',
    phone:'phone',
    fax:'fax',
    company:'company',
    'street2|address2':'address_street2',
    'street1|address1|street':'address_street1',
    city:'address_city',
    'zip|postal':'address_zip',
    'state|province':'address_province',
    country:'address_country',
    country_code:'address_country_code',
    'latitude|lat':'address_latitude',
    'longitude|lng|long':'address_longitude',
  }

  for (const [match, value] of Object.entries(provides)) {
    if (key.search(new RegExp(match, 'i')) !== -1) {
      return value;
    }
  }
  return '';
}


const keyToLabel = (string) => {
  string = string;
  return string
    // Split CamelCase into words https://stackoverflow.com/a/18379502/2308553
    .replace(/([a-z](?=[A-Z]))/g, '$1 ')
    // Replace _, - with spaces
    .replace(/\_|\-/g, ' ')
    // Proper Case
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
    // Manual cleanup
    .replace('Id', 'ID');
}


const generateFields = (json) => {

  let fields = [];
  const type = typeof json;
  if (!json || type !== 'object') {
    return [];
  }

  for (const [key, value] of Object.entries(json)) {
    let field = {
      key: key,
      label: keyToLabel(key),
      type: 'text',
      data_type: 'string',
      provides: detectProvides(key),
      description: '',
      required: required,
      importance: importance,
    };
    let type = typeof value;
    switch (type) {
      case 'object':
        type = value instanceof Array ? 'array' : type;
        field.type = type;
        field.data_type = type;
        field.fields = generateFields(value);
        field.allow_custom_fields = allowcustom;
        delete field.provides;
      break;
      default:
        switch (type) {
          case 'number':
            field.data_type = type;
          break;
          case 'boolean':
            field.data_type = type;
            field.type = 'checkbox';
          break;
        }
    }
    fields.push(field);
  }

  return fields;
}


files.forEach(function(file) {
  const filepath = `${dir}/${file}`;
  const filename = path.parse(filepath).base;
  const extension = path.extname(filename);
  if (extension === '.json') {
    let json = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    let out = generateFields(json);
    out = JSON.stringify(out, null, 2);
    const outFilename = `${dir}/${output}${filename}`;
    if (print) {
      console.log(out);
    }
    else {
      console.log(`Saving ${outFilename}`);
      fs.writeFileSync(outFilename, out);
    }
  }
});


console.log(files);