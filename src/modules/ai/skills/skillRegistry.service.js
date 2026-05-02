import collectionsSweepSkill from './collectionsSweep.skill.js';
import monthEndCloseSkill from './monthEndClose.skill.js';
import cashShortfallResponseSkill from './cashShortfallResponse.skill.js';

/**
 * Skill Registry
 *
 * Skills are multi-step playbooks the agent can plan and execute. Each skill
 * exports:
 *   - id, label, trigger (one-line description used by intent router)
 *   - plan(context) → returns a Plan: { steps: [...], rationale }
 *   - execute(plan, context, runners) → runs steps until first approval gate,
 *     returns updated plan with step results, status, and a summary
 *
 * Step shape:
 *   { id, kind: 'tool'|'llm'|'approval'|'mutation', label, status, result, ... }
 *
 * The orchestrator wires runners (callTool, callLLM) so skills stay decoupled
 * from infrastructure.
 */

const SKILLS = {
    [collectionsSweepSkill.id]: collectionsSweepSkill,
    [monthEndCloseSkill.id]: monthEndCloseSkill,
    [cashShortfallResponseSkill.id]: cashShortfallResponseSkill
};

class AISkillRegistryService {
    listSkills() {
        return Object.values(SKILLS).map(s => ({
            id: s.id,
            label: s.label,
            trigger: s.trigger,
            domain: s.domain || null,
            destructive: Boolean(s.destructive)
        }));
    }

    getSkill(skillId) {
        return SKILLS[skillId] || null;
    }

    async planSkill(skillId, context = {}) {
        const skill = this.getSkill(skillId);
        if (!skill) throw new Error(`Unknown skill: ${skillId}`);
        return skill.plan(context);
    }

    async executeSkill(skillId, plan, context = {}, runners = {}) {
        const skill = this.getSkill(skillId);
        if (!skill) throw new Error(`Unknown skill: ${skillId}`);
        return skill.execute(plan, context, runners);
    }
}

export default new AISkillRegistryService();
