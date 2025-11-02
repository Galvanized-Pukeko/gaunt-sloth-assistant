# Installation

## GitHub (master)

Install dev version globally

```bash
git clone https://github.com/Galvanized-Pukeko/gaunt-sloth-assistant.git
npm install
npm install -g ./
```
## Testing

Unit tests are implemented with [Vitest](https://vitest.dev/).

Running unit tests:

```bash
npm run test
```

## Running tests on both Windows and WSL

If you first installed deps on Windows and then running tests on WSL
or vice versa you're likely to experience an error like

```
Error: Cannot find module @rollup/rollup-linux-x64-gnu. npm has a bug related to optional dependencies 
```

or 

```
'tsc' is not recognized as an internal or external command, operable program or batch file.
```

Simply install that missing *optional* rollup dependency or TypeScript without saving it, 
like that:

`npm install @rollup/rollup-linux-x64-gnu --no-save`

or 

`npm install typescript --no-save`

This will allow switching between environments and run tests in both.

## Generate and Publish documentation.

git@github.com:gaunt-sloth-assistant/gaunt-sloth-assistant.github.io.git should be cloned in the same parent dir as `gaunt-sloth-assistant`.

Run
```
./update-docs.sh
```

Commit and push from `gaunt-sloth-assistant.github.io`
