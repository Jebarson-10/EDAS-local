import type { RuleParameters } from "@exam-duty/shared";
import {
  allocateTheory,
  type TheoryAllocationResult,
  type TheoryDataset,
  type TheoryRequirement,
  ALGORITHM_VERSION,
} from "../theory/allocate.js";
import {
  schedulePractical,
  type PracticalDataset,
  type PracticalResult,
  type PracticalSchoolDemand,
  PRACTICAL_ALGORITHM_VERSION,
} from "../practical/schedule.js";
import {
  allocateHall,
  type HallCentreDemand,
  type HallDataset,
  type HallResult,
  HALL_ALGORITHM_VERSION,
} from "../hall/allocate.js";

export type AllocationInput =
  | {
      module: "THEORY";
      requirements: TheoryRequirement[];
      dataset: TheoryDataset;
      rules: RuleParameters;
    }
  | {
      module: "PRACTICAL";
      demands: PracticalSchoolDemand[];
      dataset: PracticalDataset;
      rules: RuleParameters;
    }
  | {
      module: "HALL";
      demands: HallCentreDemand[];
      dataset: HallDataset;
      rules: RuleParameters;
    };

export type AllocationOutput =
  | { module: "THEORY"; result: TheoryAllocationResult }
  | { module: "PRACTICAL"; result: PracticalResult }
  | { module: "HALL"; result: HallResult };

export interface SolverAdapter {
  readonly algorithmVersion: string;
  solve(input: AllocationInput): AllocationOutput;
}

export class DeterministicSolverAdapter implements SolverAdapter {
  readonly algorithmVersion = `combined:${ALGORITHM_VERSION}+${PRACTICAL_ALGORITHM_VERSION}+${HALL_ALGORITHM_VERSION}`;

  solve(input: AllocationInput): AllocationOutput {
    switch (input.module) {
      case "THEORY":
        return {
          module: "THEORY",
          result: allocateTheory(input.requirements, input.dataset, input.rules),
        };
      case "PRACTICAL":
        return {
          module: "PRACTICAL",
          result: schedulePractical(input.demands, input.dataset, input.rules),
        };
      case "HALL":
        return {
          module: "HALL",
          result: allocateHall(input.demands, input.dataset, input.rules),
        };
      default: {
        const _exhaustive: never = input;
        return _exhaustive;
      }
    }
  }
}
