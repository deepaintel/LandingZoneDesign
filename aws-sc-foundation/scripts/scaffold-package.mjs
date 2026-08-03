#!/usr/bin/env node

import { mkdir, writeFile, access } from "node:fs/promises"
import { constants } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")
const packagesDir = path.join(repoRoot, "packages")

function printUsage() {
	console.log(
		'Usage: pnpm run scaffold:package -- <package-name> [--description "Short description"] [--dry-run]',
	)
}

function toKebabCase(value) {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-{2,}/g, "-")
}

function toPascalCase(value) {
	return value
		.split("-")
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join("")
}

function parseArgs(argv) {
	let name
	let description = "Minimal AWS CDK package"
	let dryRun = false

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index]

		if (arg === "--description") {
			description = argv[index + 1] ?? description
			index += 1
			continue
		}

		if (arg === "--dry-run") {
			dryRun = true
			continue
		}

		if (arg === "--help" || arg === "-h") {
			printUsage()
			process.exit(0)
		}

		if (!name) {
			name = arg
			continue
		}
	}

	if (!name) {
		printUsage()
		throw new Error("Missing package name.")
	}

	const normalizedName = toKebabCase(name)
	if (!normalizedName) {
		throw new Error("Package name must contain letters or numbers.")
	}

	return {
		name: normalizedName,
		description,
		dryRun,
	}
}

async function pathExists(targetPath) {
	try {
		await access(targetPath, constants.F_OK)
		return true
	} catch {
		return false
	}
}

function renderPackageJson({ packageName, description }) {
	return `${JSON.stringify(
		{
			name: packageName,
			version: "0.1.0",
			private: true,
			type: "module",
			description,
			bin: {
				[packageName]: `bin/${packageName}.js`,
			},
			scripts: {
				build: "tsc",
				test: "vitest run",
				synth: "cdk synth",
				diff: "cdk diff",
				deploy: "cdk deploy --all --require-approval never",
				validate: "pnpm run build && pnpm run test && pnpm run synth",
				"prettier:format": "prettier --write .",
				"prettier:check": "prettier --check .",
			},
			dependencies: {
				"aws-cdk-lib": "catalog:",
				constructs: "catalog:",
			},
			devDependencies: {
				"@ccoe-aws/ccoe-config": "catalog:",
				"@types/node": "catalog:",
				"aws-cdk": "catalog:",
				prettier: "catalog:",
				tsx: "catalog:",
				vitest: "catalog:",
				typescript: "catalog:",
			},
		},
		null,
		"\t",
	)}
`
}

function renderCdkJson({ packageName }) {
	return `${JSON.stringify(
		{
			app: `npx tsx bin/${packageName}.ts`,
			context: {},
		},
		null,
		"\t",
	)}
`
}

function renderTsconfig() {
	return `${JSON.stringify(
		{
			compilerOptions: {
				target: "ES2022",
				module: "NodeNext",
				moduleResolution: "NodeNext",
				lib: ["es2022"],
				strict: true,
				esModuleInterop: true,
				forceConsistentCasingInFileNames: true,
				skipLibCheck: true,
				outDir: "dist",
				types: ["node"],
			},
			include: ["bin/**/*.ts", "lib/**/*.ts"],
		},
		null,
		"\t",
	)}
`
}

function renderVitestConfig() {
	return `import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
	},
});
`
}

function renderPrettierConfig() {
	return `import { prettierConfig } from '@ccoe-aws/ccoe-config';

export default prettierConfig;
`
}

function renderBinTs({ packageName, stackClassName, stackFactoryName }) {
	return `#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { pathToFileURL } from 'node:url';
import { ${stackClassName} } from '../lib/${packageName}-stack.js';

export function ${stackFactoryName}(app: cdk.App): ${stackClassName} {
	const account = process.env.CDK_DEFAULT_ACCOUNT;
	const region = process.env.CDK_DEFAULT_REGION;

	return new ${stackClassName}(app, '${stackClassName}', {
		env: account || region ? { account, region } : undefined,
	});
}

const isDirectExecution = process.argv[1]
	? import.meta.url === pathToFileURL(process.argv[1]).href
	: false;

if (isDirectExecution) {
	const app = new cdk.App();
	${stackFactoryName}(app);
}
`
}

function renderStackTs({ stackClassName }) {
	return `import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class ${stackClassName} extends cdk.Stack {
	constructor(scope: Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);

		new cdk.CfnOutput(this, 'StackName', {
			value: this.stackName,
		});
	}
}
`
}

function renderBinTest({ packageName, stackFactoryName }) {
	return `import { afterEach, describe, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ${stackFactoryName} } from './${packageName}.js';

function clearStackEnv(): void {
	delete process.env.CDK_DEFAULT_ACCOUNT;
	delete process.env.CDK_DEFAULT_REGION;
}

afterEach(() => {
	clearStackEnv();
});

describe('${packageName} bin entrypoint', () => {
	it('synthesizes the generated stack', ({ expect }) => {
		const app = new cdk.App();
		const stack = ${stackFactoryName}(app);
		const template = Template.fromStack(stack);

		template.hasOutput('StackName', {
			Value: '${toPascalCase(packageName)}Stack',
		});
		expect(stack.stackName).toBe('${toPascalCase(packageName)}Stack');
	});

	it('passes through account and region from environment variables', ({ expect }) => {
		process.env.CDK_DEFAULT_ACCOUNT = '111111111111';
		process.env.CDK_DEFAULT_REGION = 'eu-west-1';

		const app = new cdk.App();
		const stack = ${stackFactoryName}(app);

		expect(stack.account).toBe('111111111111');
		expect(stack.region).toBe('eu-west-1');
	});
});
`
}

function renderStackTest({ packageName, stackClassName }) {
	return `import { describe, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ${stackClassName} } from './${packageName}-stack.js';

function makeTemplate(): Template {
	const app = new cdk.App();
	const stack = new ${stackClassName}(app, 'TestStack');
	return Template.fromStack(stack);
}

describe('${stackClassName}', () => {
	it('synthesizes the stack name output', () => {
		const template = makeTemplate();

		template.hasOutput('StackName', {
			Value: 'TestStack',
		});
	});

	it('contains no resources in the minimal template', () => {
		const template = makeTemplate();

		template.resourceCountIs('AWS::CloudFormation::WaitConditionHandle', 0);
	});
});
`
}

async function writeGeneratedFiles(targetDir, files, dryRun) {
	if (dryRun) {
		for (const filePath of files.map((file) => file.path)) {
			console.log(`[dry-run] ${path.relative(repoRoot, filePath)}`)
		}
		return
	}

	for (const file of files) {
		await mkdir(path.dirname(file.path), { recursive: true })
		await writeFile(file.path, file.content, "utf8")
	}

	console.log(
		`Created package scaffold in ${path.relative(repoRoot, targetDir)}`,
	)
}

async function main() {
	const { name, description, dryRun } = parseArgs(
		process.argv.slice(2).filter((arg) => arg !== "--"),
	)
	const packageName = name
	const packageDir = path.join(packagesDir, packageName)
	const stackClassName = `${toPascalCase(packageName)}Stack`
	const stackFactoryName = `create${stackClassName}`

	if (await pathExists(packageDir)) {
		throw new Error(
			`Package already exists: ${path.relative(repoRoot, packageDir)}`,
		)
	}

	const files = [
		{
			path: path.join(packageDir, "package.json"),
			content: renderPackageJson({ packageName, description }),
		},
		{
			path: path.join(packageDir, "cdk.json"),
			content: renderCdkJson({ packageName }),
		},
		{
			path: path.join(packageDir, "tsconfig.json"),
			content: renderTsconfig(),
		},
		{
			path: path.join(packageDir, "vitest.config.ts"),
			content: renderVitestConfig(),
		},
		{
			path: path.join(packageDir, "prettier.config.mjs"),
			content: renderPrettierConfig(),
		},
		{
			path: path.join(packageDir, "bin", `${packageName}.ts`),
			content: renderBinTs({ packageName, stackClassName, stackFactoryName }),
		},
		{
			path: path.join(packageDir, "bin", `${packageName}.test.ts`),
			content: renderBinTest({ packageName, stackFactoryName }),
		},
		{
			path: path.join(packageDir, "lib", `${packageName}-stack.ts`),
			content: renderStackTs({ stackClassName }),
		},
		{
			path: path.join(packageDir, "lib", `${packageName}-stack.test.ts`),
			content: renderStackTest({ packageName, stackClassName }),
		},
	]

	await writeGeneratedFiles(packageDir, files, dryRun)

	if (dryRun) {
		console.log(`Dry run complete for packages/${packageName}`)
		return
	}

	console.log("Next steps:")
	console.log("1. pnpm install")
	console.log(`2. pnpm --filter ${packageName} run validate`)
}

main().catch((error) => {
	console.error(error.message)
	process.exit(1)
})
