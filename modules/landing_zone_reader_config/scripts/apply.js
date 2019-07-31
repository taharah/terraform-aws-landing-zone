'use strict';

const Helper = require('./helper');

const { ROOT_PATH: rootPath, COMPONENTS: components } = process.env;

/**
 * Check if required env variables are defined
 * @return {Promise}
 */
async function checkEnvironmentVars() {
  if (!rootPath) {
    return Promise.reject(Error('ERROR: ROOT_PATH variable is empty. Aborting...'));
  }

  if (!components) {
    return Promise.reject(Error('ERROR: COMPONENTS variable is empty. Aborting...'));
  }
}

/**
 * Run terrahub output
 * @param {Array} include
 */
async function terrahubOutput(include) {
  let outputMap = [];

  await Helper.executeWithoutErrors(
    'terrahub',
    [
      'configure',
      '--config',
      'component.template.data',
      '--delete',
      '--auto-approve',
      '--include',
      'terrahub_load_outputs'
    ],
    rootPath
  );

  await Promise.all(
    include.map(async item => {
      await Helper.cli(
        'terrahub',
        ['init', '--include', item],
        rootPath
      );

      const result = await Helper.cli(
        'terrahub',
        ['output', '--format', 'json', '--include', item, '--auto-approve'],
        rootPath
      );

      if (!result.length) {
        throw new Error('No terraform outputs found. Before using `landing_zone_reader` module, '+
          'make sure that `landing_zone` module generates output. Learn more: https://github.com/TerraHubCorp/terraform-aws-landing-zone/');
      }
      
      const outputValues = await extractOutputValues(result);
      const prepareOutput = `map(${outputValues.join(',')})`;

      outputMap = [...outputMap, ...[prepareOutput]];
    })
  );

  try {
    await Helper.cli(
      'terrahub',
      [
        'configure',
        '--include',
        'terrahub_load_outputs',
        '--config',
        `component.template.output.terrahub_reader.value=merge(${outputMap.join(',')})`
      ],
      rootPath
    );
    await Helper.cli('terrahub', ['run', '--include', 'terrahub_load_outputs', '--apply', '--auto-approve'], rootPath);
    await Helper.cli('terrahub', ['refresh', '--include', 'terrahub_load_outputs'], rootPath);
  } catch (error) {
    console.log('Error', error);
  }

  return 'Success';
}

/**
 * Extract output values
 * @param {String} result
 * @return {Promise<Array>}
 */
async function extractOutputValues(result) {
  const processes = [];
  let outputMap = [];
  const terrahubConfig = ['configure', '--include', 'terrahub_load_outputs', '--config'];
  const jsonResult = JSON.parse(result);

  Object.keys(jsonResult).forEach(key => {
    processes.push([...terrahubConfig, ...[`component.template.data.terraform_remote_state.${key}.backend=local`]]);
    processes.push([
      ...terrahubConfig,
      ...[
        `component.template.data.terraform_remote_state.${key}` +
          `.config.path=$\{tfvar.terrahub["tfstate_path"]}/${key}/terraform.tfstate`
      ]
    ]);

    Object.keys(jsonResult[key]).forEach(subKey => {
      outputMap = [...outputMap, ...[`"${subKey}"`, `data.terraform_remote_state.${key}.outputs.${subKey}`]];
    });
  });

  try {
    await Helper.executeWithErrors('terrahub', processes, rootPath);
  } catch (error) {
    return Promise.reject(error);
  }

  return outputMap;
}

/**
 * Execute
 * @return {Promise}
 */
async function main() {
  const jsonComponents = JSON.parse(components);
  const include = [];

  Object.keys(jsonComponents).forEach(key => include.push(key));

  return terrahubOutput(include);
}

(async () => {
  try {
    await checkEnvironmentVars();

    await Helper.checkIfTerrahubIsInstalled();

    const resp = await main();

    console.log(resp);
  } catch (error) {
    console.log(error);
  }
})();