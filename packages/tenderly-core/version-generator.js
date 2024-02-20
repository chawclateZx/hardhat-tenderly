#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { version } = require('./../tenderly-hardhat/package.json');

fs.writeFileSync(
  path.resolve(__dirname, 'src/internal/core/services/hardhat-tenderly-version.ts'),
  `// autogenerated by version-generator.js\nexport const HARDHAT_TENDERLY_VERSION = "${version}";`,
);