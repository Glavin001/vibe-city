import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { useNavigation } from './useNavigation';
import type { Vector3Tuple } from 'three';
import { type CrowdAgent, type CrowdAgentParams, vec3 } from 'recast-navigation';
import { ECS } from '../../store/ecs';

export type AgentProps = {
  initialPosition: Vector3Tuple;
} & Partial<CrowdAgentParams>;

export const Agent = forwardRef<CrowdAgent | undefined, AgentProps>(({ initialPosition, ...crowdAgentParams }, ref) => {
  const { crowd } = useNavigation();
  const entity = ECS.useCurrentEntity();

  const [agent, _setAgent] = useState<CrowdAgent | undefined>();
  const setAgent = useCallback(
    (agent: CrowdAgent | undefined) => {
      _setAgent(agent);
      if (entity) {
        entity.crowdAgent = agent;
      }
    },
    [entity],
  );

  useImperativeHandle(ref, () => agent, [agent]);

  useEffect(() => {
    if (!crowd) {
      console.warn('No crowd');
      return;
    }

    const agent = crowd.addAgent(vec3.fromArray(initialPosition), {
      height: 1,
      radius: 0.5,
      ...(crowdAgentParams ?? {}),
    });

    // Use a small delay to ensure agent is fully added to crowd system
    // before making it available via ref
    setTimeout(() => {
      setAgent(agent);
    }, 50);

    return () => {
      setAgent(undefined);

      crowd.removeAgent(agent);
    };
    // We intentionally only create the agent once when crowd is available
    // initialPosition and crowdAgentParams are captured from props at creation time
    // If these need to change, the component should be remounted with a new key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crowd, setAgent]);

  return null;
});
