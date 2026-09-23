import { writeFileSync } from 'node:fs';

export default class EvidenceReporter {
  files = [];
  collected = [];

  onTestRunStart(specifications) {
    this.files = specifications.map((specification) => specification.taskId);
  }

  onTestModuleCollected(module) {
    this.collected.push(...[...module.children.allTests()].map((test) => test.id));
  }

  onTestRunEnd(modules, errors, reason) {
    const tests = modules.flatMap((module) =>
      [...module.children.allTests()].map((test) => ({
        id: test.id,
        file: module.id,
        name: test.fullName,
        status: test.result().state,
        retryCount: test.diagnostic()?.retryCount ?? null,
        repeatCount: test.diagnostic()?.repeatCount ?? null,
        flaky: test.diagnostic()?.flaky ?? null,
        expectedFailure: test.options.fails === true,
      })),
    );
    const suites = modules.flatMap((module) =>
      [module, ...module.children.allSuites()].map((suite) => ({
        name: suite.fullName ?? module.relativeModuleId,
        status: suite.state(),
        testCount: [...suite.children.allTests()].length,
      })),
    );
    writeFileSync(
      process.env.FRONTEND_TEST_REPORT,
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: 'unit',
          runId: process.env.FRONTEND_TEST_RUN_ID,
          complete: reason === 'passed',
          files: this.files,
          completedFiles: modules.map((module) => module.id),
          collectedTests: this.collected,
          tests,
          suites,
          errors: errors.map((error) => ({ name: error.name, message: error.message })),
        },
        null,
        2,
      ) + '\n',
    );
  }
}
