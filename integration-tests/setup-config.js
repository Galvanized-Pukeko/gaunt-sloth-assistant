import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configName = process.argv[2];

const validConfigs = [
  'groq',
  'anthropic',
  'vertexai',
  'deepseek',
  'openai',
  'inception',
  'google-genai',
  'xai',
  'openrouter',
];

console.log(`Provided config "${configName}"`);
if (!configName) {
  console.error(`Please provide a config name: ${validConfigs.join(', ')}`);
  process.exit(1);
}

if (!validConfigs.includes(configName)) {
  console.error(`Invalid config name. Must be one of: ${validConfigs.join(', ')}`);
  process.exit(1);
}

const sourceFile = path.join(__dirname, 'configs', `${configName}.gsloth.config.json`);
const targetFile = path.join(__dirname, '.gsloth.config.json');

// Remove existing config if it exists
if (fs.existsSync(targetFile)) {
  fs.unlinkSync(targetFile);
  console.log('Removed existing .gsloth.config.json');
}

// Copy the selected config
try {
  fs.copyFileSync(sourceFile, targetFile);
  console.log(`Copied ${configName}.gsloth.config.json to .gsloth.config.json`);
} catch (error) {
  console.error(`Error copying config file: ${error.message}`);
  process.exit(1);
}

// Read provider LLm block for profile-specific configs
let providerLLM = undefined;
try {
  const providerConfigRaw = fs.readFileSync(sourceFile, 'utf8');
  const providerConfig = JSON.parse(providerConfigRaw);
  providerLLM = providerConfig?.llm;
  if (!providerLLM) {
    console.warn(
      'Warning: No "llm" block found in provider config. Profile configs will not include an "llm" section.'
    );
  }
} catch (error) {
  console.error(`Error reading provider config "${sourceFile}": ${error.message}`);
  process.exit(1);
}

// Helper: recursively gather all files named "source.gsloth.config.json" under a directory
function findSourceConfigs(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findSourceConfigs(fullPath));
    } else if (entry.isFile() && entry.name === 'source.gsloth.config.json') {
      results.push(fullPath);
    }
  }
  return results;
}

// Generate .gsloth.config.json next to each source.gsloth.config.json
const settingsRoot = path.join(__dirname, 'workdir-with-profiles', '.gsloth', '.gsloth-settings');

if (fs.existsSync(settingsRoot)) {
  const sourceConfigs = findSourceConfigs(settingsRoot);
  if (sourceConfigs.length === 0) {
    console.log(`No source.gsloth.config.json files found under ${settingsRoot}`);
  } else {
    console.log(
      `Found ${sourceConfigs.length} source.gsloth.config.json file(s) under ${settingsRoot}`
    );
  }

  for (const srcPath of sourceConfigs) {
    try {
      const raw = fs.readFileSync(srcPath, 'utf8');
      const baseConfig = JSON.parse(raw);

      const merged = {
        ...baseConfig,
        ...(providerLLM ? { llm: providerLLM } : {}),
      };

      const outPath = path.join(path.dirname(srcPath), '.gsloth.config.json');
      fs.writeFileSync(outPath, JSON.stringify(merged, null, 2), 'utf8');
      console.log(`Created ${outPath} from ${path.relative(__dirname, srcPath)} + provider llm`);
    } catch (e) {
      console.error(`Failed to create profile config for "${srcPath}": ${e.message}`);
      process.exitCode = 1;
    }
  }
} else {
  console.warn(`Profiles settings directory not found: ${settingsRoot}`);
}

const reviewPath = path.join(__dirname, 'testreview.md');
if (fs.existsSync(reviewPath)) {
  fs.unlinkSync(reviewPath);
  console.log(`Removed testreview.md`);
}
