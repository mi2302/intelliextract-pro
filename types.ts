
export enum ExportFormat {
  XLS = 'xls',
  CSV = 'csv',
  PIPE = 'pipe',
  PSV = 'psv',
  FBDI = 'fbdi',
  XLSM = 'xlsm',
  FBDI_XLSM = 'FBDI-XLSM',
  FBDI_ZIP = 'FBDI-ZIP',
  REST = 'rest',
  SOAP = 'soap',
}

export enum TransformationType {
  UPPERCASE = 'UPPERCASE',
  LOWERCASE = 'LOWERCASE',
  AI_SUMMARY = 'AI_SUMMARY',
  CONCAT = 'CONCAT',
  LOOKUP = 'LOOKUP',
  DATE_FORMAT = 'DATE_FORMAT',
  TRIM = 'TRIM',
  REGEX_REPLACE = 'REGEX_REPLACE',
  AGGREGATE_SUM = 'AGGREGATE_SUM',
  CONDITIONAL_LOGIC = 'CONDITIONAL_LOGIC',
  PHONE_FORMAT = 'PHONE_FORMAT',
  MASK_DATA = 'MASK_DATA',
  SUBSTRING = 'SUBSTRING',
  COALESCE = 'COALESCE',
  MULTIPLY = 'MULTIPLY',
  MAP_VALUE = 'MAP_VALUE',
}

export enum FilterOperator {
  EQUALS = '=',
  NOT_EQUALS = '!=',
  GREATER_THAN = '>',
  LESS_THAN = '<',
  CONTAINS = 'LIKE',
  IN = 'IN',
}

export interface FilterCondition {
  id: string;
  field: string; // Object.Field
  operator: FilterOperator;
  value: string;
}

export interface TransformationStep {
  id: string;
  type: TransformationType;
  params?: Record<string, any>;
}

export interface ColumnDefinition {
  id: string;
  sourceField: string; // mapped to Object.Field
  targetName: string;
  tableName?: string;
  columnName?: string;
  columnComment?: string;
  transformations: TransformationStep[];
  confidenceScore?: number;
  reasoning?: string;
}

export interface DataField {
  name: string;
  type: 'STRING' | 'NUMBER' | 'DATE' | 'BOOLEAN';
  description: string;
}

export interface DataObject {
  id: string;
  name: string;
  tableName: string;
  fields: DataField[];
}

export interface ObjectRelationship {
  sourceObjectId: string;
  targetObjectId: string;
  joinType: 'INNER' | 'LEFT';
  condition: string; // e.g., source.id = target.source_id
}

export type DBType = 'POSTGRES' | 'ORACLE' | 'CSV';

export interface ObjectGroup {
  id: string;
  modelId?: string; // ID from Oracle XX_INTELLI_MODELS
  name: string;
  templateName?: string; // Standardized OCI template name
  databaseType: DBType;
  objects: DataObject[];
  relationships: ObjectRelationship[];
}

export interface FileSpecification {
  id: string;
  name: string;
  version: string | number;
  objectGroupId: string;
  columns: ColumnDefinition[];
  filters: FilterCondition[];
  format: ExportFormat;
  createdAt: string;
  templateData?: string; // Base64 or JSON representation of the original template structure
  sheetName?: string; // The specific sheet name in the template
  backendTemplateName?: string; // Filename of the staged template on the server
}

export interface DatabaseConfig {
  id?: string;
  name: string;
  type: DBType;
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  isActive?: boolean;
}

export interface DatabaseConfigData {
  activeConfigId: string | null;
  configs: DatabaseConfig[];
}

export interface FusionConfig {
  id: string;
  name: string;
  url: string;
  username: string;
  password?: string;
  defaultDbId?: string;
  ociNamespace?: string;
  ociBucketName?: string;
  ociRegion?: string;
  ociCredentialName?: string;
  ociUserOcid?: string;
  ociTenancyOcid?: string;
  ociFingerprint?: string;
  ociPrivateKey?: string;
  isActive?: boolean;
}

export interface FusionConfigData {
  activeConfigId: string | null;
  configs: FusionConfig[];
}

export interface AppState {
  groups: ObjectGroup[];
  specifications: FileSpecification[];
  selectedGroup: ObjectGroup | null;
  activeSpec: FileSpecification | null;
  dbConfig: DatabaseConfig | null;
}
