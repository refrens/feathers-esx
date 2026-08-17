const { getDocDescriptor } = require('../../utils');
const createBulkCore = require('./core');

// Elasticsearch bulk API takes two objects per index or create operation.
// First is the action descriptor, the second is usually the data.
// https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/api-reference.html#api-bulk
// reduce() here is acting as a map() mapping one element into two.

/**
 * External versioning, when the service declares `elasticsearch.versionField`.
 *
 * Stamps each bulk item with `version` derived from that field (typically `updatedAt`) and
 * `version_type: external_gte`. Elasticsearch then refuses any write carrying a version older
 * than what is already stored, which makes bulk loads idempotent and order-independent: a row
 * derived from an older snapshot can never overwrite a newer live write, and re-running a
 * backfill is safe. Rejected items come back as 409 version_conflict_engine_exception, which
 * the caller should count and ignore rather than treat as an error.
 */
function getVersioning(service, doc) {
  const field = service.esOptions && service.esOptions.versionField;

  if (!field || doc[field] === undefined || doc[field] === null) {
    return {};
  }

  const version = typeof doc[field] === 'number' ? doc[field] : Date.parse(doc[field]);

  if (!Number.isFinite(version)) {
    return {};
  }

  return { version, version_type: 'external_gte' };
}

function getBulkCreateParams(service, data, params) {
  return {
    body: data.reduce((result, item) => {
      const { id, parent, routing, join, doc } = getDocDescriptor(service, item);
      const method = id !== undefined && !params.upsert ? 'create' : 'index';

      if (join) {
        doc[service.join] = {
          name: join,
          parent,
        };
      }

      // `create` fails outright if the document exists, so versioning only applies to `index`.
      const versioning = method === 'index' ? getVersioning(service, doc) : {};

      result.push({ [method]: { _id: id, routing, ...versioning } });
      result.push(doc);

      return result;
    }, []),
    ...service.esParams,
  };
}

function createBulk(...args) {
  return createBulkCore(...args, { getBulkCreateParams });
}

module.exports = createBulk;
