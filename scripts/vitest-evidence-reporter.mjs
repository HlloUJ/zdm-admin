import assert from 'node:assert/strict';
import path from 'node:path';
import { statSync, writeFileSync } from 'node:fs';

export default class EvidenceReporter {
  files = [];
  collected = [];

  onInit(context) {
    this.context = context;
  }

  async onTestRunStart(specifications) {
    this.files = specifications.map((specification) => specification.taskId);
    if (process.env.FRONTEND_TEST_KIND === 'related') {
      const sources = this.context.config.related;
      assert.ok(Array.isArray(sources) && sources.length > 0, 'Related testing requires explicit source files');
      for (const source of sources) {
        const relative = path.relative(this.context.config.root, source);
        assert.ok(
          relative && !relative.startsWith('../') && !path.isAbsolute(relative),
          'Related source is outside the project',
        );
        assert.ok(statSync(source).isFile(), `Related source is not a file: ${source}`);
      }
      // Use the same resolver that selected this run, including project and dependency configuration.
      const universe = await this.context.globTestSpecifications([]);
      const relevant = await this.context.getRelevantTestSpecifications([]);
      assert.deepEqual(
        relevant.map((item) => item.taskId).sort(),
        [...this.files].sort(),
        'Related selection changed during discovery',
      );
      this.selection = {
        resolver: 'vitest-dependency-graph',
        complete: true,
        sources,
        universe: universe.map((item) => item.taskId),
        selected: this.files,
      };
    }
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
          kind: process.env.FRONTEND_TEST_KIND ?? 'unit',
          runId: process.env.FRONTEND_TEST_RUN_ID,
          complete: reason === 'passed',
          files: this.files,
          selection: this.selection,
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
