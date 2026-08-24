/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable  @typescript-eslint/no-explicit-any */
// TypeScript Version: 3.0
import { Params, Paginated, Id, NullableId, Query, Hook } from '@feathersjs/feathers';
import {
  AdapterService,
  ServiceOptions,
  InternalServiceMethods,
} from '@feathersjs/adapter-commons';
import { Client } from 'elasticsearch';

/** Behaviour options that must NOT be spread into Elasticsearch requests. */
export interface ElasticsearchServiceEsOptions {
  /**
   * Sets `track_total_hits` in the search body. Without it Elasticsearch stops counting at
   * 10,000 and any larger paginated result reports a wrong `total`.
   */
  trackTotalHits?: boolean;
  /**
   * Document field (e.g. `updatedAt`) used to derive an external version, so writes are
   * ordered by document time rather than arrival and bulk loads become idempotent.
   */
  versionField?: string;
}

/**
 * Params accepted by `_create` in addition to the standard Feathers params.
 */
export interface ElasticsearchCreateParams extends Params {
  /**
   * Use the `index` bulk action rather than `create`, so writing a document that already
   * exists overwrites it instead of failing. Also enables external versioning when the
   * service declares `esOptions.versionField`.
   */
  upsert?: boolean;
  /**
   * Skip the `mget` that normally follows a bulk write. The returned array then holds
   * `mapBulk` metadata records rather than the fetched source documents, so only use this
   * when the return value is discarded (e.g. a background sync to a secondary store).
   */
  $noFetch?: boolean;
}

export interface ElasticsearchServiceOptions extends ServiceOptions {
  Model: Client;
  elasticsearch: any;
  esVersion: string;
  parent: string;
  routing: string;
  join: string;
  meta: string;
  esParams: Record<string, any>;
  esOptions: ElasticsearchServiceEsOptions;
}

export class Service<T = any> extends AdapterService implements InternalServiceMethods<T> {
  Model: Client;

  options: ElasticsearchServiceOptions;

  /** Params spread verbatim into every Elasticsearch request (index, refresh, ...). */
  readonly esParams: Record<string, any>;

  /** Behaviour options, deliberately kept out of `esParams`. */
  readonly esOptions: ElasticsearchServiceEsOptions;

  constructor(config?: Partial<ElasticsearchServiceOptions>);

  getModel(params: Params): any;

  _find(params?: Params): Promise<T | T[] | Paginated<T>>;

  _get(id: Id, params?: Params): Promise<T>;

  _create(
    data: Partial<T> | Array<Partial<T>>,
    params?: ElasticsearchCreateParams,
  ): Promise<T | T[]>;

  _update(id: NullableId, data: T, params?: Params): Promise<T>;

  _patch(id: NullableId, data: Partial<T>, params?: Params): Promise<T>;

  _remove(id: NullableId, params?: Params): Promise<T>;
}

declare const elasticsearch: (config?: Partial<ElasticsearchServiceOptions>) => Service;
export default elasticsearch;
/* eslint-enable @typescript-eslint/no-explicit-any */
/* eslint-enable import/no-extraneous-dependencies */
/* eslint-enable  @typescript-eslint/no-unused-vars */
