#!/usr/bin/env node
// Author: Damian "Rush" Kaczmarek

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const child_process = require('child_process');

let packageJson;
try {
  packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
} catch(err) {
  console.error('Cannot open package.json:', err);
  process.exit(1);
}

const moduleAliases = packageJson._moduleAliases;
if(!moduleAliases) {
  console.error(`_moduleAliases in package.json is empty, skipping`);
  process.exit(0);
}

const { promisify } = require('util');

const stat = promisify(fs.stat);
const lstat = promisify(fs.lstat);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const readdir = promisify(fs.readdir);
const symlink = promisify(fs.symlink);
const mkdir = promisify(fs.mkdir);
const rmdir = promisify(fs.rmdir);

const chalk = require('chalk');

const LINK_ALIAS_PREFIX = '.link-module-alias-';
const LINK_ALIAS_NESTED_SEPARATOR = '--';
const DIR_LINK_TYPE = ((process.platform === 'win32') ? 'junction' : 'dir');

async function copyDir(src, dest) {
  const entries = await fsp.readdir(src, { withFileTypes: true });
  await fsp.mkdir(dest);
  
  for (let entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      
      if(entry.isDirectory()) {
        await copyDir(srcPath,destPath);
      } else {
        await fsp.copyFile(srcPath,destPath);
      }
  }
}

async function tryRemove(path) {
  try {
    return await unlink(path);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
};

async function tryRmdir(src) {
  if (fs.existsSync(src)) {
    const statKey = await lstat(src);
    if (!statKey.isDirectory()) {
      return;
    }

    const entries = await fsp.readdir(src, { withFileTypes: true });

    for (let entry of entries) {
      const srcPath = path.join(src, entry.name);

      if (entry.isDirectory()) {
        await tryRmdir(srcPath);
      } else {
        await unlink(srcPath);
      }
    }

    await fsp.rmdir(src);
  }
};

function addColor({moduleName, type, target}) {
  if(type === 'none') {
    return chalk.red(moduleName) + ` -> ${chalk.bold(chalk.red('ALREADY EXISTS'))}`;
  } else if(type === 'copy') {
    return chalk.cyan(moduleName) + ` -> ${chalk.bold(target)}`;
  } else if(type === 'proxy') {
    return chalk.green(moduleName) + ` -> ${chalk.bold(target)}`;
  }
  return `${moduleName} `;
}

function addColorRemove({moduleName, type}) {
  if(type === 'none') {
    moduleName = chalk.red(moduleName);
  } else if(type === 'copy') {
    moduleName = chalk.cyan(moduleName);
  } else if(type === 'proxy') {
    moduleName = chalk.green(moduleName);
  }
  return moduleName;
}

function getModuleAlias(moduleName) {
  // Replace any nested alias names with "--"
  return `${LINK_ALIAS_PREFIX}${moduleName.replace(/\//g, LINK_ALIAS_NESTED_SEPARATOR)}`;
}

function getModuleNameFromAliasFile(aliasFileName) {
  // See if this matches the prefix and return the module name, if present
  const m = aliasFileName.match(new RegExp(`^\\${LINK_ALIAS_PREFIX}(.*)`)); // RegExp = /^\.link-module-alias-(.*)/
  return m && m[1].replace(new RegExp(LINK_ALIAS_NESTED_SEPARATOR, 'g'), '/'); // RegExp = /--/g
}

async function exists(filename) {
  try {
    await stat(filename);
    return true;
  } catch(err) {
    return false;
  }
}

async function removeModule(moduleName) {
  const moduleDir = path.join('node_modules', moduleName);
  let statKey;
  try {
    statKey = await lstat(moduleDir);
  } catch(err) {}

  let type;
  if(statKey && statKey.isDirectory()) {
    await tryRmdir(moduleDir);
    await tryRmdir(path.join('node_modules', getModuleAlias(moduleName)));
    type = 'copy';
  } else if(statKey) {
    await tryRemove(path.join(moduleDir, 'package.json'));
    await tryRmdir(moduleDir);
    await tryRemove(path.join('node_modules', getModuleAlias(moduleName)));
    type = 'proxy';
  } else {
    type = 'none';
  }
  return { moduleName, type };
}

function js(strings, ...interpolatedValues) {
  return strings.reduce((total, current, index) => {
    total += current;
    if (interpolatedValues.hasOwnProperty(index)) {
      total += JSON.stringify(interpolatedValues[index]);
    }
    return total;
  }, '');
}

async function copyModule(moduleName) {
  const moduleDir = path.join('node_modules', moduleName);
  const moduleExists = await exists(moduleDir);
  const copyExists = moduleExists && await exists(path.join('node_modules', getModuleAlias(moduleName)));
  const target = moduleAliases[moduleName];

  if (moduleName.match(/^@/) && !packageJson._moduleAliasIgnoreWarning) {
    console.warn(
      chalk.yellow(`WARNING! Using @ in front of your module name ${moduleName} may cause data loss. Please read this issue thread https://github.com/Rush/link-module-alias/issues/3 and make a backup before executing any npm/yarn commands. The issue ultimately can be blamed on npm/yarn. You've been warned.`) +
        ` -- you can disable this warning by setting _moduleAliasIgnoreWarning to true in your package.json`
    );
  }

  let type;
  if(moduleExists && !copyExists) {
    await removeModule(moduleName);
  }

  if(target.match(/\.js$/)) {
    // console.log(`Target ${target} is a direct copy, creating proxy require`);
    await mkdir(moduleDir);
    await writeFile(path.join(moduleDir, 'package.json'), js`
      {
        "name": ${moduleName},
        "main": ${path.join('../../', target)}
      }
    `);
    type = 'proxy';
  } else {
    const stat = fs.statSync(target);
    if(!stat.isDirectory) {
      console.log(`Target ${target} is not a directory, skipping ...`);
      type = 'none';
      return { moduleName, type, target };
    }
    // Check if there is a nested alias
    if (moduleName.includes('/')) {
      // If every directory is already made, mkdir will throw an error
      try {
        // We need to create every directory except the last
        let parentDirectories = moduleName.substr(0, moduleName.lastIndexOf('/'));
        await mkdir(path.join('node_modules', parentDirectories), { recursive: true });
      } catch (err) {
        if (err.code !== 'EEXISTS') {
          throw err;
        }
      }
    }

    await copyDir(target, moduleDir);
    type = 'copy';
  }
  await writeFile(path.join('node_modules', getModuleAlias(moduleName)), '');
  return { moduleName, type, target };
}

async function copyModules() {
  try { await mkdir('node_modules'); } catch(err) {}
  const modules = await Promise.all(Object.keys(moduleAliases).map(async key => {
    return copyModule(key);
  }));
  console.log('copy-module-alias:', modules.map(addColor).join(', '));
}

async function removeModules() {
  const nodeModulesExists = await exists('node_modules');
  if(!nodeModulesExists) {
    return;
  }
  const allModules = await readdir('node_modules');

  const modules = allModules.map(getModuleNameFromAliasFile).filter(v => !!v);

  const removedModules = await Promise.all(modules.map(mod => {
    return removeModule(mod);
  }));
  if(removedModules.length) {
    console.log('copy-module-alias: Cleaned ', removedModules.filter(v => {
      return v.type !== 'none';
    }).map(addColorRemove).join(' '));
  } else {
    console.log('copy-module-alias: No modules to clean');
  }
}

if(process.argv[2] === 'clean') {
  removeModules();
} else {
  copyModules();
}
