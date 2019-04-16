var request = require("request");
const config = require('config-yml');
let apiUrl = 'https://api.getmesa.com/dev/admin';

module.exports = function(method, data){

  // Let the api url be overwritten in config.yml
  apiUrl = config.api_url ? config.api_url : apiUrl;

  const options = {
    url: `${apiUrl}/${config.uuid}/scripts.json`,
    method: method,
    headers: { 'x-api-key': config.key },
    body: data,
    json: true,
  };
  // console.log(options);
  request(options, function (error, response, body) {
    if (error) {
      console.log(error.response.data);
    }
    else {
      console.log('Success');
    }
  });

}
