# packserve

Serve package tarballs over HTTP. This is especially useful to test packages as-if they were served via NPM.

## Why not `npm link`

`npm link` will only create a symlink to the package source, which may include files that will be not present in the actual published package. It will also symlink the `node_modules` directory, which may accidentally pull dependencies that would've not been installed otherwise.

## Usage

```bash
npx packserve -p 3123 -d ./packages/sdk-js ./packages/sdk-js-react
```

After which you can consume the packages with:

```bash
npm install --save-dev http://localhost:3123/123/sdk-js@1.0.0
```

## Bumping the nonce

To bust the NPM cache, you must bump the nonce within your `package.json`, which will trigger a new `npm pack` invocation.
