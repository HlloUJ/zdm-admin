import path from 'node:path';
import { resourceObservation, performanceSummary } from './e2e-performance.mjs';
import { writeFileSync } from 'node:fs';
import { validatePlaywrightTestReport } from './playwright-test-evidence.mjs';

const identity = (test) => `${test.id}:${test.repeatEachIndex}`;
const errorDetails = (error) => ({ message: error.message ?? String(error), stack: error.stack });

export default class PlaywrightEvidenceReporter {
  selected = [];
  completed = [];
  suites = [];
  errors = [];
  timings = new Map();
  observations = [];

  printsToStdio() {
    return false;
  }

  onBegin(_config, suite) {
    this.before = resourceObservation();
    // onBegin receives exactly the chosen files/projects/grep/shard, not other shards' cases.
    this.selected = suite.allTests().map(identity);
    const visit = (entry) => {
      if (['file', 'describe'].includes(entry.type))
        this.suites.push({ name: entry.title, tests: entry.allTests().length });
      entry.suites.forEach(visit);
    };
    visit(suite);
  }

  onStepEnd(test, result, step) {
    const key = `${identity(test)}:${result.retry}`;
    const totals = this.timings.get(key) ?? { hookMs: 0, navigationMs: null, contextMs: null };
    if (step.category === 'hook' && !step.parent) totals.hookMs += step.duration;
    if (step.category === 'pw:api' && /Navigate|Reload|\.goto|\.reload/i.test(step.title))
      totals.navigationMs = (totals.navigationMs ?? 0) + step.duration;
    if (step.category === 'pw:api' && /Create context|newContext/i.test(step.title))
      totals.contextMs = (totals.contextMs ?? 0) + step.duration;
    this.timings.set(key, totals);
  }
  onTestEnd(test, result) {
    this.completed.push(test);
    this.observations.push({
      id: identity(test),
      retry: result.retry,
      durationMs: result.duration,
      workerIndex: result.workerIndex,
      ...this.timings.get(`${identity(test)}:${result.retry}`),
    });
  }
  onError(error) {
    this.errors.push(errorDetails(error));
  }

  onEnd(result) {
    const report = {
      schemaVersion: 1,
      runId: process.env.PLAYWRIGHT_TEST_RUN_ID,
      complete: true,
      status: result.status,
      selected: this.selected,
      suites: this.suites,
      errors: this.errors,
      tests: this.completed.map((test) => ({
        id: identity(test),
        name: test.titlePath().join(' > '),
        expectedStatus: test.expectedStatus,
        outcome: test.outcome(),
        results: test.results.map((attempt) => ({
          status: attempt.status,
          retry: attempt.retry,
          errors: attempt.errors.map(errorDetails),
        })),
      })),
    };
    writeFileSync(
      path.join(path.dirname(process.env.PLAYWRIGHT_TEST_REPORT), 'e2e-performance.json'),
      JSON.stringify(
        performanceSummary(this.observations, this.before ?? resourceObservation(), resourceObservation()),
        null,
        2,
      ) + '\n',
    );
    writeFileSync(process.env.PLAYWRIGHT_TEST_REPORT, JSON.stringify(report, null, 2) + '\n');
    try {
      validatePlaywrightTestReport(report, process.env.PLAYWRIGHT_TEST_RUN_ID);
    } catch (error) {
      console.error(`Playwright evidence rejected: ${error.message}`);
      return { status: 'failed' };
    }
  }
}
