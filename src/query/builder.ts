import { Reference } from '../types'
import { inArray, createProxy } from '../utils'

type QueryReturnType<T> = [string, T]

type Single<T> = T
type Multiple<T> = T[]

type ResolveFieldType<T> = T extends Record<string, any>
  ? MapResolver<T>
  : ResolverAction<T>

type ResolverFunction<T> = <P extends keyof T>(
  prop: P
) => ResolveFieldType<T[P]>

type ResolverAction<T> = T extends Reference<infer A>
  ? { use: () => T; resolve: ResolverFunction<A> }
  : { use: () => T }

type MapResolver<T extends Record<string, any>> = {
  [P in keyof T]: ResolveFieldType<T[P]>
} &
  ResolverAction<T>

type Combine<
  Original extends Record<string, any>,
  New extends Record<string, any>
> = Omit<Original, keyof New> & New

export class QueryBuilder<
  Schema extends Record<string, any>,
  Mappings extends Record<string, any>,
  Type = Multiple<any>,
  Project extends boolean = true,
  Exclude extends string = ''
> {
  private schema: Schema
  private type: string
  private ordering: [keyof Schema, 'asc' | 'desc'][]
  private projections: Record<string, string>
  private mappings: Record<string, string>
  private selector: string
  private project: boolean
  private restricted: boolean

  constructor(
    schema: Schema,
    type: string,
    ordering: [keyof Schema, 'asc' | 'desc'][] = [],
    projections: Record<string, string> = {},
    mappings: Record<string, string> = schema,
    selector = '',
    project = true,
    restricted = false
  ) {
    this.schema = schema
    this.type = type
    this.projections = projections
    this.mappings = mappings
    this.selector = selector
    this.project = project
    this.ordering = ordering
    this.restricted = restricted
  }

  orderBy<Key extends keyof Schema>(key: Key, order: 'asc' | 'desc' = 'asc') {
    return new QueryBuilder(
      this.schema,
      this.type,
      [...this.ordering, [key, order]],
      this.projections,
      this.mappings,
      this.selector,
      this.project,
      this.restricted
    )
  }

  select(
    from: number,
    to: number,
    inclusive = false
  ): Omit<
    QueryBuilder<Schema, Mappings, Type, Project, Exclude | 'first' | 'select'>,
    Exclude | 'first' | 'select'
  > {
    return new QueryBuilder(
      this.schema,
      this.type,
      this.ordering,
      this.projections,
      this.mappings,
      ` [${from}..${inclusive ? '.' : ''}${to}]`,
      this.project,
      this.restricted
    ) as Omit<
      QueryBuilder<
        Schema,
        Mappings,
        Type,
        Project,
        Exclude | 'first' | 'select'
      >,
      Exclude | 'first' | 'select'
    >
  }

  // eslint-disable-next-line no-dupe-class-members
  pick<R extends keyof Mappings>(
    props: R[]
  ): Omit<
    QueryBuilder<Schema, Pick<Mappings, R>, Type, true, Exclude | 'pick'>,
    Exclude | 'pick'
  >

  // eslint-disable-next-line no-dupe-class-members
  pick<R extends keyof Mappings>(
    props: R
  ): Omit<
    QueryBuilder<Schema, Pick<Mappings, R>, Type, false, Exclude | 'pick'>,
    Exclude | 'pick'
  >

  // eslint-disable-next-line no-dupe-class-members
  pick(props: any) {
    const project = Array.isArray(props)
    const projections = inArray(props).reduce((obj, key) => {
      obj[key as string] = key as string
      return obj
    }, {} as Record<string, string>)

    return new QueryBuilder(
      this.schema,
      this.type,
      this.ordering,
      projections,
      this.mappings,
      this.selector,
      project,
      true
    ) as any
  }

  first(): Omit<
    QueryBuilder<
      Schema,
      Mappings,
      Single<Schema>,
      Project,
      Exclude | 'select' | 'first'
    >,
    Exclude | 'select' | 'first'
  > {
    return new QueryBuilder(
      this.schema,
      this.type,
      this.ordering,
      this.projections,
      this.mappings,
      ' [0]',
      this.project,
      this.restricted
    ) as Omit<
      QueryBuilder<
        Schema,
        Mappings,
        Single<Schema>,
        Project,
        Exclude | 'select' | 'first'
      >,
      Exclude | 'select' | 'first'
    >
  }

  map<NewMapping extends Record<string, any>>(
    map: NewMapping | ((resolver: MapResolver<Schema>) => NewMapping)
  ): Omit<
    QueryBuilder<
      Schema,
      Combine<Mappings, NewMapping>,
      Type,
      Project,
      Exclude | 'map'
    >,
    Exclude | 'map'
  > {
    let mappings: Combine<Mappings, NewMapping>

    function checkCallable(
      m: NewMapping | ((resolver: MapResolver<Schema>) => NewMapping)
    ): m is (resolver: MapResolver<Schema>) => NewMapping {
      return typeof m === 'function'
    }

    if (checkCallable(map)) {
      mappings = map(createProxy([])) as Combine<Mappings, NewMapping>
    } else {
      mappings = map as Combine<Mappings, NewMapping>
    }

    return new QueryBuilder(
      this.schema,
      this.type,
      this.ordering,
      this.projections,
      mappings,
      this.selector,
      this.project,
      this.restricted
    ) as Omit<
      QueryBuilder<
        Schema,
        Combine<Mappings, NewMapping>,
        Type,
        Project,
        Exclude | 'map'
      >,
      Exclude | 'map'
    >
  }

  get option() {
    return [`_type == '${this.type}'`].join(' && ')
  }

  get order() {
    if (!this.ordering.length) return ''

    return ` | order(${this.ordering
      .map(([key, order]) => `${key} ${order}`)
      .join(', ')})`
  }

  get projection() {
    const entries = Object.entries({
      ...this.projections,
      ...this.mappings,
    }).filter(([key]) => typeof key === 'string')

    if (!this.project && entries.length === 1) return `.${entries[0][1]}`
    if (!entries.length) return ''

    const innerProjection = [
      ...(this.restricted ? [] : ['...']),
      ...entries.map(([key, val]) => (key === val ? key : `"${key}": ${val}`)),
    ].join(', ')

    return ` { ${innerProjection} }`
  }

  get query() {
    return `*[${this.option}]${this.order}${this.selector}${this.projection}`
  }

  use() {
    return [
      this.query,
      this.selector === ' [0]' ? null : [],
    ] as Type extends Array<any>
      ? Project extends true
        ? QueryReturnType<Array<Mappings>>
        : QueryReturnType<Array<Mappings[keyof Mappings]>>
      : Project extends true
      ? QueryReturnType<Mappings>
      : QueryReturnType<Mappings[keyof Mappings]>
  }
}
