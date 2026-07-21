// CommonJS on purpose: package.json has no "type": "module", so a .js file here
// is parsed as CommonJS. Node 22 auto-detects ESM syntax and reparses, but
// Node 18 does not and fails with "Unexpected token 'export'". The .cjs
// extension makes the format explicit and survives adding "type": "module".
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
