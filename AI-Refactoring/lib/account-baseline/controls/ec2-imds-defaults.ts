/**
 * Control 3 - EC2 instance metadata account defaults: `HttpTokens=required`,
 * `HttpPutResponseHopLimit=2`, for FUTURE launches in the home Region.
 *
 * Reads `GetInstanceMetadataDefaults` (`AccountLevel`). Account defaults apply only to new launches:
 * launch-time and launch-template values take precedence over them, and existing instances, launch
 * templates, Auto Scaling groups and AMIs are never modified (EC2 user guide, "Order of precedence
 * for instance metadata options").
 *
 * Each field is classified and written INDEPENDENTLY, with one `ModifyInstanceMetadataDefaults`
 * call per field, so a call never carries a value for a field that must be preserved (an omitted
 * parameter is left unchanged):
 *  - absent or `no-preference` (hop limit absent or -1): set to the target;
 *  - already at the target: preserved;
 *  - any other explicit value: REQUIRES_APPROVAL, never overwritten.
 * Settings managed by an EC2 declarative policy (`ManagedBy=declarative-policy`) are never written:
 * COMPLIANT when they already match, otherwise REQUIRES_APPROVAL. `HttpTokensEnforced` is reported
 * but never set in v1.0.
 */

import type { InstanceMetadataDefaults } from '../ports.js';
import type { BaselineWrite } from '../types.js';
import { defineControl, type BaselineControl, type ClassifiedState } from './control.js';

export type ImdsObservation = InstanceMetadataDefaults;

type FieldVerdict = 'unset' | 'target' | 'conflict';

export function httpTokensVerdict(value: string | undefined): FieldVerdict {
  if (value === undefined || value === 'no-preference') return 'unset';
  return value === 'required' ? 'target' : 'conflict';
}

export function hopLimitVerdict(value: number | undefined): FieldVerdict {
  if (value === undefined || value === -1) return 'unset';
  return value === 2 ? 'target' : 'conflict';
}

export function describeImds(observation: ImdsObservation): string {
  const hop = observation.HttpPutResponseHopLimit;
  return (
    `HttpTokens=${observation.HttpTokens ?? 'no-preference'}, ` +
    `HttpPutResponseHopLimit=${hop === undefined || hop === -1 ? 'no-preference' : String(hop)}, ` +
    `HttpTokensEnforced=${observation.HttpTokensEnforced ?? 'no-preference'}, ` +
    `ManagedBy=${observation.ManagedBy ?? 'account'}`
  );
}

export function classifyImds(observation: ImdsObservation): ClassifiedState {
  const observed = describeImds(observation);
  const tokens = httpTokensVerdict(observation.HttpTokens);
  const hop = hopLimitVerdict(observation.HttpPutResponseHopLimit);
  const managedBy = observation.ManagedBy ?? 'account';

  if (managedBy !== 'account' && managedBy !== 'declarative-policy') {
    return { status: 'REQUIRES_APPROVAL', observed, writes: [], reasons: [`unexpected ManagedBy '${managedBy}'`] };
  }
  if (tokens === 'target' && hop === 'target') return { status: 'COMPLIANT', observed, writes: [], reasons: [] };
  if (managedBy === 'declarative-policy') {
    return {
      status: 'REQUIRES_APPROVAL',
      observed,
      writes: [],
      reasons: [
        'instance metadata defaults are managed by an EC2 declarative policy and differ from the target; ' +
          'the baseline never overrides a declarative policy'
      ]
    };
  }

  const reasons: string[] = [];
  if (tokens === 'conflict') {
    reasons.push(
      `HttpTokens is explicitly '${observation.HttpTokens ?? ''}'; the explicit account setting is preserved`
    );
  }
  if (hop === 'conflict') {
    reasons.push(
      `HttpPutResponseHopLimit is explicitly ${String(observation.HttpPutResponseHopLimit)}; the explicit account setting is preserved`
    );
  }
  if (reasons.length > 0) return { status: 'REQUIRES_APPROVAL', observed, writes: [], reasons };

  const writes: BaselineWrite[] = [];
  if (tokens === 'unset')
    writes.push({ kind: 'ModifyInstanceMetadataDefaults', field: 'HttpTokens', value: 'required' });
  if (hop === 'unset') {
    writes.push({ kind: 'ModifyInstanceMetadataDefaults', field: 'HttpPutResponseHopLimit', value: 2 });
  }
  return {
    status: 'NON_COMPLIANT',
    observed,
    writes,
    reasons: ['unset instance metadata defaults will be set, one field per call']
  };
}

const control: BaselineControl<ImdsObservation> = {
  id: 'ec2-imds-defaults',
  title: 'EC2 IMDSv2 account defaults',
  settle: { attempts: 12, intervalSeconds: 5 },
  required: (context) =>
    `HttpTokens=${context.controls.ec2ImdsDefaults.httpTokens}, ` +
    `HttpPutResponseHopLimit=${String(context.controls.ec2ImdsDefaults.httpPutResponseHopLimit)} (future launches)`,
  read: (port) => port.getInstanceMetadataDefaults(),
  classify: (observation) => classifyImds(observation),
  invariantProblems: (before, after) => {
    // Fields this control does not own must not change, and owned fields only move towards the target.
    const problems: string[] = [];
    for (const field of ['HttpEndpoint', 'InstanceMetadataTags', 'HttpTokensEnforced'] as const) {
      if (before[field] !== after[field]) {
        problems.push(
          `${field} changed from '${before[field] ?? 'no-preference'}' to '${after[field] ?? 'no-preference'}'`
        );
      }
    }
    if (httpTokensVerdict(before.HttpTokens) !== 'unset' && before.HttpTokens !== after.HttpTokens) {
      problems.push(`HttpTokens changed from '${before.HttpTokens ?? ''}' to '${after.HttpTokens ?? ''}'`);
    }
    if (
      hopLimitVerdict(before.HttpPutResponseHopLimit) !== 'unset' &&
      before.HttpPutResponseHopLimit !== after.HttpPutResponseHopLimit
    ) {
      problems.push(
        `HttpPutResponseHopLimit changed from ${String(before.HttpPutResponseHopLimit)} to ${String(after.HttpPutResponseHopLimit)}`
      );
    }
    return problems;
  }
};

export const ec2ImdsDefaultsControl = defineControl(control);
