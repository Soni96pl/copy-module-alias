### If you use `@` in your linked module names, there is a risk this module will cause data loss
See this issue https://github.com/Rush/link-module-alias/issues/3

# copy-module-alias

Setup private modules within your repo to get away from error-prone typing of long relative paths like these:
```js
require('../../../../some/very/deep/module')
```

Just create an alias and do it cleanly:

```js
var module = require('@deep/module')
// Or ES6
import module from '@deep/module'
```

You can setup aliases both to individual files and to directories.

**WARNING** Use this module only in final applications. It will not work inside published npm packages.

## Install

```
npm i --save-dev copy-module-alias
```

## Usage

Add your custom configuration to your `package.json` (in your application's root), and setup automatic initialization in your scripts section.

Note: you can use `@` in front of your module but before of the possible data loss https://github.com/Rush/link-module-alias/issues/3

```js
"scripts": {
  "postinstall": "copy-module-alias"
},
// Aliases
"_moduleAliases": {
  "~root"      : ".", // Application's root
  "~deep"      : "src/some/very/deep/directory/or/file",
  "@my_module" : "lib/some-file.js", // can be @ - but see above comment and understand the associated risk
  "something"  : "src/foo", // Or without ~. Actually, it could be any string
}
```

If you encounter issues with installing modules, you may want to set up the preinstall script as well:
```js
"scripts": {
  "postinstall": "copy-module-alias",
  "preinstall": "command -v copy-module-alias && copy-module-alias clean || true"
}
```

## How does it work?

- For aliases to directories, we copy files.
- For aliases to files, we create proxy modules with a package.json containing `"main"` that points to the target file

## Background

This module it's almost a drop in replacement for another package https://www.npmjs.com/package/module-alias - use module `module-alias` if you like runtime require hooks and use `copy-module-alias` if you want good compatibility with your IDE and no runtime hacks.

The key differentiator of `copy-module-alias` is copying all modules statically in form of symlinks and proxy packages inside `node_modules`, there is no hacky require hook and you don't need to load any supporting packages.

The key motivator to create `copy-module-alias` was to make it work in environments that don't support symlinks.

## License

MIT. Attribution to the `module-alias` for parts for the README and original idea.

# Contributors

[@kwburnett](https://github.com/kwburnett)
[@Rush](https://github.com/Rush)
