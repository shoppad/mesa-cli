# mesa-cli

Command-line interface to download, watch and publish Mesa Scripts

## Configuring sites

Create a new directory with a config.yml file:
```yaml
uuid: mystoreuuid
key: J0lSB0PIuw145xhk610Ud6dLA7A****B7LnfUjaL
```
- Key is your site's Mesa Key from the Mesa Dashboard
- Optional parameter: `api_url`.

## Usage

Download the scripts and configuration from a shop into the current directory:
```
mesa initialize -e poulet-sauvage \
    --inputs=in-tracktor-alerts \
    --outputs=out-tracktor-email,out-tracktor-twilio \
    --files=tracktor/in-tracktor-alerts.js,tracktor/out-tracktor-email.js,tracktor/out-tracktor-twilio.js \
    --storage=tracktor-sms-in-transit.liquid,tracktor-email-in-transit.liquid,tracktor-email-subject-in-transit \
    --secrets=tracktor-twilio-token,tracktor-twilio-phone-number,tracktor-twilio-sid
```

Then use the utility functions to keep your local code in sync with Mesa:
```
mesa watch
mesa push <...files>
mesa pull <...files>
```

## Specifying environments

1. Save configuration files in `./config`. For example: `./config/mystoreuuid.yml`
2. Pass the environment with the `--env` or `-e` flags, or by setting the `ENV` envvar:
```
mesa watch --env mystoreuuid
mesa watch -e mystoreuuid
ENV=mystoreuuid mesa watch
export ENV=mystoreuuid && mesa watch
```
[Full details on usage](https://www.npmjs.com/package/config-yml)

## Local development

https://medium.com/netscape/a-guide-to-create-a-nodejs-command-line-package-c2166ad0452e

## @todos
- Handle dependencies
- Handle recursively uploading dirs
- Hide source code for all files in vendor/

