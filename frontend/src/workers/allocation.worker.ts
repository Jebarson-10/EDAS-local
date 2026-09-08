/// <reference lib="webworker" />
import {
  DeterministicSolverAdapter,
  type TheoryDataset,
  type TheoryRequirement,
} from "@exam-duty/allocation-engine";
import { validateTheoryAllocation } from "@exam-duty/validator";
import type { RuleParameters } from "@exam-duty/shared";

export type WorkerRequest = {
  type: "THEORY";
  requirements: TheoryRequirement[];
  dataset: TheoryDataset;
  rules: RuleParameters;
};

export type WorkerProgress = {
  type: "progress";
  stage: string;
};

export type WorkerResult = {
  type: "result";
  allocation: ReturnType<DeterministicSolverAdapter["solve"]>;
  validation: ReturnType<typeof validateTheoryAllocation>;
};

const solver = new DeterministicSolverAdapter();

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  const post = (data: WorkerProgress | WorkerResult) => self.postMessage(data);

  post({ type: "progress", stage: "Preparing data..." });
  post({ type: "progress", stage: "Calculating eligibility..." });
  post({ type: "progress", stage: "Applying constraints..." });
  post({ type: "progress", stage: "Optimizing..." });

  const allocation = solver.solve({
    module: "THEORY",
    requirements: msg.requirements,
    dataset: msg.dataset,
    rules: msg.rules,
  });

  post({ type: "progress", stage: "Validating..." });
  if (allocation.module !== "THEORY") {
    throw new Error("Unexpected module");
  }
  const validation = validateTheoryAllocation(
    msg.requirements,
    allocation.result,
    msg.dataset,
    msg.rules,
  );
  post({ type: "progress", stage: "Finalizing..." });
  post({ type: "result", allocation, validation });
};
