#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { evaluateAdvisor } from '../lib/plan-advisor.mjs';
import { createJevAdvisor } from '../lib/jev-advisor.mjs';

// Separate explicit evaluation entry point; never invoked by the delivery gate.
const args = process.argv.slice(2);
if (!args[0] || args.some((arg, i) => i > 0 && arg !== '--jev')) {
  console.error('Usage: node tools/evaluate-plan-advisor.mjs corpus.json [--jev]');
  process.exitCode = 2;
} else {
  try {
    const cases = JSON.parse(await readFile(args[0], 'utf8'));
    const advisor = args.includes('--jev') ? createJevAdvisor({ apiKey: process.env.TYPESAFE_API_KEY }) : undefined;
    const baseline = await evaluateAdvisor(cases);
    const shadow = advisor ? await evaluateAdvisor(cases, { advisor }) : null;
    console.log(JSON.stringify({ version: 1, baseline, shadow, liveProviderEvaluated: Boolean(advisor), note: 'Explicit --jev transmits design data to TypeSafe. Cost remains unknown without injected pricing. Classifiers never authorize code.' }, null, 2));
    if (shadow?.unavailable) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
