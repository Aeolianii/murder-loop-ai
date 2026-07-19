import { FactSchema, type Fact } from '@murder-loop-ai/ai-contracts';

export class FactLedger {
  readonly #facts = new Map<string, Fact>();

  constructor(facts: Fact[] = []) {
    for (const fact of facts) this.add(fact);
  }

  add(input: Fact): void {
    const fact = FactSchema.parse(input);
    if (this.#facts.has(fact.id)) {
      throw new Error(`Fact ${fact.id} already exists.`);
    }
    this.#facts.set(fact.id, cloneFact(fact));
  }

  invalidate(factId: string, invalidatingEventId: string): void {
    const fact = this.#facts.get(factId);
    if (!fact) throw new Error(`Fact ${factId} does not exist.`);
    if (!invalidatingEventId) throw new Error('An invalidating event id is required.');
    if (fact.invalidatedBy) {
      throw new Error(`Fact ${factId} was already invalidated by ${fact.invalidatedBy}.`);
    }
    this.#facts.set(factId, { ...fact, invalidatedBy: invalidatingEventId });
  }

  get(factId: string): Fact | undefined {
    const fact = this.#facts.get(factId);
    return fact ? cloneFact(fact) : undefined;
  }

  allFacts(): Fact[] {
    return [...this.#facts.values()].map(cloneFact);
  }

  activeFacts(): Fact[] {
    return this.allFacts().filter((fact) => !fact.invalidatedBy);
  }

  factsFor(viewerId: string): Fact[] {
    return this.activeFacts().filter((fact) => (
      fact.visibleTo.includes('public')
      || fact.visibleTo.includes(viewerId)
      || fact.knownBy.includes(viewerId)
    ));
  }
}

function cloneFact(fact: Fact): Fact {
  return structuredClone(fact) as Fact;
}
