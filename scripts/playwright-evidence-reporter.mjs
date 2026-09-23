import { writeFileSync } from 'node:fs';
import { validatePlaywrightTestReport } from './playwright-test-evidence.mjs';

const identity = (test) => `${test.id}:${test.repeatEachIndex}`;
const errorDetails = (error) => ({ message: error.message ?? String(error), stack: error.stack });

export default class PlaywrightEvidenceReporter {
  selected = [];
  completed = [];
  suites = [];
  errors = [];

  printsToStdio() {
    return false;
  }

  onBegin(_config, suite) {
    // onBegin receives exactly the chosen files/projects/grep/shard, not other shards' cases.
    this.selected = suite.allTests().map(identity);
    const visit = (entry) => {
      if (['file', 'describe'].includes(entry.type))
        this.suites.push({ name: entry.title, tests: entry.allTests().length });
      entry.suites.forEach(visit);
    };
    visit(suite);
  }

  onTestEnd(test) {
    this.completed.push(test);
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
    writeFileSync(process.env.PLAYWRIGHT_TEST_REPORT, JSON.stringify(report, null, 2) + '\n');
    try {
      validatePlaywrightTestReport(report, process.env.PLAYWRIGHT_TEST_RUN_ID);
    } catch (error) {
      console.error(`Playwright evidence rejected: ${error.message}`);
      return { status: 'failed' };
    }
  }
}
