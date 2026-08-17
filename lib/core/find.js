const { parseQuery, mapFind } = require('../utils');

function find(service, params) {
  const { filters, query, paginate } = service.filterQuery(params);
  const esQuery = parseQuery(query, service.id);
  const findParams = {
    _source: filters.$select,
    from: filters.$skip,
    size: filters.$limit,
    sort: filters.$sort,
    body: {
      query: esQuery ? { bool: esQuery } : undefined,
      // Elasticsearch stops counting matches at 10,000 by default and reports
      // { value: 10000, relation: 'gte' }, so any paginated result set larger than that
      // reports a wrong `total`. Opt in per service via `elasticsearch.trackTotalHits`.
      ...(service.esOptions && service.esOptions.trackTotalHits !== undefined
        ? { track_total_hits: service.esOptions.trackTotalHits }
        : {}),
    },
    ...service.esParams,
  };

  // The `refresh` param is not recognised for search in Es.
  delete findParams.refresh;

  return service.Model.search(findParams).then((result) =>
    mapFind(
      result,
      service.id,
      service.meta,
      service.join,
      filters,
      !!(paginate && paginate.default),
    ),
  );
}

module.exports = find;
