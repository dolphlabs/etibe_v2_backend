import * as fs from "fs";
import * as path from "path";

/**
 * Copies compiled ABI + bytecode from Hardhat artifacts into the
 * NestJS-accessible abis directory so deployCircleContract can use them.
 */

const artifactPath = path.resolve(
  __dirname,
  "../artifacts/contracts/EtibeCircle.sol/EtibeCircle.json",
);
const outputPath = path.resolve(
  __dirname,
  "../src/modules/blockchain/abis/EtibeCircle.json",
);

if (!fs.existsSync(artifactPath)) {
  console.error(
    "❌ Artifact not found. Run `pnpm hardhat compile` first.",
  );
  process.exit(1);
}

const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));

const output = {
  abi: artifact.abi,
  bytecode: artifact.bytecode,
};

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n");

console.log(`✅ ABI + bytecode copied to ${outputPath}`);
console.log(`   Bytecode length: ${artifact.bytecode.length} chars`);
