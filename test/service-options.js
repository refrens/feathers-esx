/* eslint-disable no-underscore-dangle */
const { expect } = require('chai');
const { Service } = require('../lib');

/**
 * These run without an Elasticsearch server: the constructor makes no requests, and the bulk
 * tests below drive a stub client. They cover the `esParams` / `esOptions` split and the
 * external versioning stamped onto bulk actions.
 */
describe('Elasticsearch service options', () => {
  const makeService = (elasticsearch) =>
    new Service({ Model: {}, esVersion: '6.0', elasticsearch });

  describe('esParams / esOptions split', () => {
    // The regression test for the staging + qa01 outage: a behaviour option that leaks into
    // esParams is spread into every request, and Elasticsearch 8 rejects the whole search with
    // `unrecognized parameter: [versionField]`.
    it('keeps behaviour options out of esParams', () => {
      const service = makeService({
        index: 'refrens_documents',
        trackTotalHits: true,
        versionField: 'updatedAt',
      });

      expect(service.esParams).to.not.have.property('trackTotalHits');
      expect(service.esParams).to.not.have.property('versionField');
    });

    it('exposes behaviour options on esOptions', () => {
      const service = makeService({ trackTotalHits: true, versionField: 'updatedAt' });

      expect(service.esOptions.trackTotalHits).to.equal(true);
      expect(service.esOptions.versionField).to.equal('updatedAt');
    });

    it('passes every other elasticsearch option through to esParams unchanged', () => {
      const service = makeService({ index: 'people', type: 'doc', refresh: true });

      expect(service.esParams).to.deep.equal({ index: 'people', type: 'doc', refresh: true });
    });

    it('defaults esParams.refresh to false and esOptions to undefined when not configured', () => {
      const service = makeService({ index: 'people' });

      expect(service.esParams).to.deep.equal({ index: 'people', refresh: false });
      expect(service.esOptions.trackTotalHits).to.equal(undefined);
      expect(service.esOptions.versionField).to.equal(undefined);
    });
  });

  describe('external versioning on bulk create', () => {
    // Returns the action descriptors (every other element) of the bulk body the service sent.
    const bulkActionsFor = async (elasticsearch, docs, params) => {
      let body;
      const service = new Service({
        Model: {
          bulk: (sent) => {
            body = sent.body;
            return Promise.resolve({ items: [] });
          },
        },
        esVersion: '6.0',
        elasticsearch,
      });

      await service._create(docs, params);

      return body.filter((_, index) => index % 2 === 0);
    };

    it('stamps external_gte from the configured versionField', async () => {
      const actions = await bulkActionsFor(
        { index: 'people', versionField: 'updatedAt' },
        [{ _id: '1', updatedAt: '2026-08-24T10:00:00.123Z' }],
        { upsert: true },
      );

      expect(actions[0].index.version).to.equal(Date.parse('2026-08-24T10:00:00.123Z'));
      expect(actions[0].index.version_type).to.equal('external_gte');
    });

    // Date.parse() on a Date object goes through toString(), which drops milliseconds. Two
    // writes in the same second would then tie, and external_gte accepts a tie.
    it('preserves milliseconds when the version field is a Date object', async () => {
      const updatedAt = new Date('2026-08-24T10:00:00.123Z');
      const actions = await bulkActionsFor(
        { index: 'people', versionField: 'updatedAt' },
        [{ _id: '1', updatedAt }],
        { upsert: true },
      );

      expect(actions[0].index.version).to.equal(updatedAt.getTime());
    });

    it('accepts an epoch number as the version', async () => {
      const actions = await bulkActionsFor(
        { index: 'people', versionField: 'updatedAt' },
        [{ _id: '1', updatedAt: 1787565600123 }],
        { upsert: true },
      );

      expect(actions[0].index.version).to.equal(1787565600123);
    });

    it('writes unversioned when the field is missing or unparsable', async () => {
      const actions = await bulkActionsFor(
        { index: 'people', versionField: 'updatedAt' },
        [{ _id: '1' }, { _id: '2', updatedAt: 'not a date' }],
        { upsert: true },
      );

      actions.forEach((action) => {
        expect(action.index).to.not.have.property('version');
        expect(action.index).to.not.have.property('version_type');
      });
    });

    it('does not version the create action, which cannot overwrite anyway', async () => {
      const actions = await bulkActionsFor(
        { index: 'people', versionField: 'updatedAt' },
        [{ _id: '1', updatedAt: '2026-08-24T10:00:00.123Z' }],
        {},
      );

      expect(actions[0]).to.have.property('create');
      expect(actions[0].create).to.not.have.property('version');
    });

    it('writes unversioned when no versionField is configured', async () => {
      const actions = await bulkActionsFor(
        { index: 'people' },
        [{ _id: '1', updatedAt: '2026-08-24T10:00:00.123Z' }],
        { upsert: true },
      );

      expect(actions[0].index).to.not.have.property('version');
    });
  });

  describe('$noFetch', () => {
    it('returns the bulk metadata without a follow-up mget', async () => {
      let mgetCalled = false;
      const service = new Service({
        Model: {
          bulk: () => Promise.resolve({ items: [{ index: { _id: '1', status: 201 } }] }),
          mget: () => {
            mgetCalled = true;
            return Promise.resolve({ docs: [] });
          },
        },
        esVersion: '6.0',
        elasticsearch: { index: 'people' },
      });

      const result = await service._create([{ _id: '1' }], { upsert: true, $noFetch: true });

      expect(mgetCalled).to.equal(false);
      expect(result[0]._meta).to.deep.equal({ _id: '1', status: 201 });
    });
  });

  /**
   * `paginate: false` with no `$limit` leaves `size` undefined, so Elasticsearch applies its
   * own default of 10 and a full export silently returns 10 rows. master fixed this in
   * `653ff91` (REF-19943); this branch forked before that commit and dropped it, which is how
   * it came back. Driven through a stub `Model.search` so no server is needed.
   */
  describe('find: size when paginate is false', () => {
    const captureSearch = async (params) => {
      let sent;
      const service = new Service({
        Model: {
          search: (findParams) => {
            sent = findParams;
            return Promise.resolve({ hits: { hits: [], total: 0 } });
          },
        },
        esVersion: '6.0',
        elasticsearch: { index: 'people' },
        paginate: { default: 10, max: 50 },
      });
      await service.find(params);
      return sent;
    };

    it('falls back to 10000 when paginate is false and no $limit is given', async () => {
      const sent = await captureSearch({ paginate: false, query: {} });
      expect(sent.size).to.equal(10000);
    });

    it('still honours an explicit $limit when paginate is false', async () => {
      const sent = await captureSearch({ paginate: false, query: { $limit: 25 } });
      expect(sent.size).to.equal(25);
    });

    it('leaves the paginated path alone', async () => {
      const sent = await captureSearch({ query: { $limit: 5 } });
      expect(sent.size).to.equal(5);
    });
  });
});
/* eslint-enable no-underscore-dangle */
