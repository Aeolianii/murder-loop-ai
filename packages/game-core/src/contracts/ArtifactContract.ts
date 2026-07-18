import type { ZodSchema } from 'zod';

/**
 * 产物契约 — Agent 之间的通信协议。
 *
 * 每个 Agent 声明自己能接受什么输入、产出什么输出。
 * 契约版本不匹配时拒绝传递，防止 Agent 升级后破坏下游。
 *
 * @template I - 输入类型
 * @template O - 输出类型
 */
export interface ArtifactContract<I = unknown, O = unknown> {
  /** 语义版本（major.minor.patch），不匹配时拒绝 */
  version: string;
  /** 输入必须满足的 Zod schema */
  input: ZodSchema<I>;
  /** 输出必须满足的 Zod schema */
  output: ZodSchema<O>;
  /** 是否在传递前校验（默认 true，性能关键路径可关闭） */
  validate: boolean;
}

/**
 * 契约校验失败时抛出。
 */
export class ContractViolationError extends Error {
  constructor(
    public contractName: string,
    public direction: 'input' | 'output',
    message: string,
  ) {
    super(`[${contractName}] ${direction} violation: ${message}`);
    this.name = 'ContractViolationError';
  }
}

/**
 * 包装一个函数，在执行前后校验契约的输入/输出。
 *
 * 用法：
 * ```ts
 * const safeHandler = enforce(parserContract, myParserFn, 'parser');
 * const result = await safeHandler(input); // 自动校验 input 和 output
 * ```
 */
export function enforce<I, O>(
  contract: ArtifactContract<I, O>,
  fn: (input: I) => Promise<O> | O,
  contractName: string,
): (input: I) => Promise<O> {
  return async (input: I): Promise<O> => {
    if (contract.validate) {
      const inputResult = contract.input.safeParse(input);
      if (!inputResult.success) {
        throw new ContractViolationError(contractName, 'input', inputResult.error.message);
      }
    }

    const output = await fn(input);

    if (contract.validate) {
      const outputResult = contract.output.safeParse(output);
      if (!outputResult.success) {
        throw new ContractViolationError(contractName, 'output', outputResult.error.message);
      }
    }

    return output;
  };
}
