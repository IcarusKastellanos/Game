import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_STATS,
  defaultProgression,
  setLicensesContent,
  setRecognitionContent,
  getLicense,
  meetsLicenseExamRequirements,
  issueLicense,
  holdsActiveLicense,
  findVowViolations,
  applyLicensureMarkPenalty,
  licenseHealingPotencyMultiplier,
  meetsSpellLicenseGate,
  licenseUnlocksSpell,
  licenseUnlocksPlace,
  licenseUnlocksSpirit,
} from '../dist/index.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function load() {
  setRecognitionContent(
    JSON.parse(readFileSync(join(root, 'content/progression/recognition-tiers.json'), 'utf8'))
  );
  setLicensesContent(
    JSON.parse(readFileSync(join(root, 'content/progression/licenses.json'), 'utf8'))
  );
}

test('licenses.json loads healer and hex credentials', () => {
  load();
  assert.ok(getLicense('healer_license'));
  assert.ok(getLicense('hex_license'));
  assert.equal(getLicense('healer_license').fee, 80);
});

test('exam eligibility requires level, recognition, skills', () => {
  load();
  const license = getLicense('healer_license');
  const weak = meetsLicenseExamRequirements(license, DEFAULT_STATS, defaultProgression());
  assert.equal(weak.ok, false);
  assert.ok(weak.reasons.length > 0);

  const stats = {
    ...DEFAULT_STATS,
    experience: 250,
    spiritualReputation: 15,
    healing: 20,
    morality: 10,
  };
  const prog = {
    ...defaultProgression(),
    recognitionTierId: 'registered_practitioner',
    recognitionTierLabel: 'Registered Practitioner',
    questProgress: {
      quest_first_steps: { questId: 'quest_first_steps', stage: 'done', startedAt: 1, completedAt: 2 },
    },
  };
  const ok = meetsLicenseExamRequirements(license, stats, prog);
  assert.equal(ok.ok, true);
});

test('issueLicense initializes marks and vow; credential gates spells/places/spirits', () => {
  load();
  const issued = issueLicense(defaultProgression(), 'healer_license');
  assert.ok(issued);
  assert.equal(holdsActiveLicense(issued.progression, 'healer_license'), true);
  assert.equal(issued.progression.licensureMarks.healer_license.marks, 10);
  assert.equal(issued.progression.activeVows.healer_license.vowId, 'vow_healer');
  assert.ok(issued.progression.storyFlags.includes('license_healer'));

  assert.equal(
    meetsSpellLicenseGate({ requiresLicense: 'healer_license' }, issued.progression),
    true
  );
  assert.equal(
    meetsSpellLicenseGate({ requiresLicense: 'healer_license' }, defaultProgression()),
    false
  );
  assert.equal(licenseUnlocksSpell('certified_healing_rite', issued.progression), true);
  assert.equal(licenseUnlocksSpell('certified_healing_rite', defaultProgression()), false);
  assert.equal(licenseUnlocksPlace('place_healer_office', issued.progression), true);
  assert.equal(licenseUnlocksSpirit('spirit_temple_attendant', issued.progression), true);
});

test('healer vow forbids baneful work and spends Licensure Marks until revoke', () => {
  load();
  let prog = issueLicense(defaultProgression(), 'healer_license').progression;
  const violations = findVowViolations(prog, { category: 'baneful', moralEffect: -4 });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].licenseId, 'healer_license');

  // Drain marks to revoke
  for (let i = 0; i < 6; i++) {
    const penalty = applyLicensureMarkPenalty(prog, 'healer_license', 2);
    prog = penalty.progression;
  }
  assert.equal(holdsActiveLicense(prog, 'healer_license'), false);
  assert.equal(prog.licensureMarks.healer_license.status, 'revoked');
});

test('hex license weakens healing potency', () => {
  load();
  const prog = issueLicense(defaultProgression(), 'hex_license').progression;
  assert.equal(licenseHealingPotencyMultiplier(prog, 'healing'), 0.25);
  assert.equal(licenseHealingPotencyMultiplier(prog, 'baneful'), 1);
});
