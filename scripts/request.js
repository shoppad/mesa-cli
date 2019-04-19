#!/usr/bin/env node

var axios = require("axios");
const config = require('config-yml');
let apiUrl = 'https://api.getmesa.com/dev/admin';

module.exports = async function(method, endpoint, data){

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
