import {
  ServiceOperationNameSchema,
  type ServiceOperationName,
  type ServiceOperationSpec,
} from '@sfp/shared';

export type ServiceOperationRegistry = Readonly<
  Partial<Record<ServiceOperationName, ServiceOperationSpec<unknown, unknown>>>
>;

export const createServiceOperationRegistry = (
  rows: readonly ServiceOperationSpec<unknown, unknown>[],
): ServiceOperationRegistry => {
  const registry: Partial<Record<ServiceOperationName, ServiceOperationSpec<unknown, unknown>>> =
    Object.create(null) as Partial<
      Record<ServiceOperationName, ServiceOperationSpec<unknown, unknown>>
    >;
  for (const row of rows) {
    const name = ServiceOperationNameSchema.parse(row.name);
    if (registry[name] !== undefined) throw new Error(`duplicate service operation: ${name}`);
    registry[name] = Object.freeze(row);
  }
  return Object.freeze(registry);
};

export const SERVICE_OPERATION_SPECS: ServiceOperationRegistry = createServiceOperationRegistry([]);
