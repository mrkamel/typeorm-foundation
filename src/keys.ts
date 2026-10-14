import type { EntityMetadata } from 'typeorm';
import { ArgumentError } from './errors';

export function getKeyMetadata(metadata: EntityMetadata, keyName: string): { columns: EntityMetadata['columns'], where?: string, deferrable: boolean } {
  const entityName = metadata.name;
  const indexMetadata = metadata.indices.find(candidate => candidate.name === keyName);

  if (indexMetadata) {
    if (!indexMetadata.isUnique) throw new ArgumentError(`Index ${keyName} on entity ${entityName} is not unique`);

    return { columns: indexMetadata.columns, where: indexMetadata.where, deferrable: false };
  }

  const uniqueMetadata = metadata.uniques.find(candidate => candidate.name === keyName);
  if (!uniqueMetadata) throw new ArgumentError(`Unknown index ${keyName} on entity ${entityName}`);

  return { columns: uniqueMetadata.columns, deferrable: Boolean(uniqueMetadata.deferrable) };
}
