
export enum ExportFormat {
  XLS = 'xls',
  CSV = 'csv',
  PIPE = 'pipe',
  PSV = 'psv',
  FBDI = 'fbdi',
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
  transformations: TransformationStep[];
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
  type: DBType;
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
}

export interface AppState {
  groups: ObjectGroup[];
  specifications: FileSpecification[];
  selectedGroup: ObjectGroup | null;
  activeSpec: FileSpecification | null;
  dbConfig: DatabaseConfig | null;
}
