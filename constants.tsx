
import React from 'react';
import { ObjectGroup, ExportFormat } from './types';

export const MOCK_METADATA: ObjectGroup[] = [
  {
    id: 'grp_supplier',
    name: 'Supplier Master Data',
    databaseType: 'ORACLE',
    objects: [
      {
        id: 'obj_sup_head',
        name: 'Supplier Header',
        tableName: 'SUPPLIER_HEADERS',
        fields: [
          { name: 'SUPPLIER_ID', type: 'NUMBER', description: 'Unique identifier for supplier' },
          { name: 'SUPPLIER_NAME', type: 'STRING', description: 'Legal name of supplier' },
          { name: 'TAX_REG_NUM', type: 'STRING', description: 'Tax registration number' },
          { name: 'STATUS', type: 'STRING', description: 'Active or Inactive status' }
        ]
      },
      {
        id: 'obj_sup_addr',
        name: 'Supplier Address',
        tableName: 'SUPPLIER_ADDRESSES',
        fields: [
          { name: 'ADDRESS_ID', type: 'NUMBER', description: 'Address ID' },
          { name: 'SUPPLIER_ID', type: 'NUMBER', description: 'Reference to header' },
          { name: 'CITY', type: 'STRING', description: 'City location' },
          { name: 'COUNTRY', type: 'STRING', description: 'Country code' }
        ]
      },
      {
        id: 'obj_sup_tax',
        name: 'Supplier Tax Info',
        tableName: 'SUPPLIER_TAX',
        fields: [
          { name: 'TAX_ID', type: 'NUMBER', description: 'Internal tax record ID' },
          { name: 'SUPPLIER_ID', type: 'NUMBER', description: 'Reference to header' },
          { name: 'TAX_RATE', type: 'NUMBER', description: 'Default tax rate' }
        ]
      }
    ],
    relationships: [
      { sourceObjectId: 'obj_sup_head', targetObjectId: 'obj_sup_addr', joinType: 'LEFT', condition: 'SUPPLIER_HEADERS.SUPPLIER_ID = SUPPLIER_ADDRESSES.SUPPLIER_ID' },
      { sourceObjectId: 'obj_sup_head', targetObjectId: 'obj_sup_tax', joinType: 'LEFT', condition: 'SUPPLIER_HEADERS.SUPPLIER_ID = SUPPLIER_TAX.SUPPLIER_ID' }
    ]
  },
  {
    id: 'grp_po',
    name: 'Purchase Order Hub',
    databaseType: 'POSTGRES',
    objects: [
      {
        id: 'obj_po_head',
        name: 'PO Header',
        tableName: 'PO_HEADERS',
        fields: [
          { name: 'PO_HEADER_ID', type: 'NUMBER', description: 'Primary key for PO' },
          { name: 'PO_NUMBER', type: 'STRING', description: 'Readable PO document number' },
          { name: 'SUPPLIER_ID', type: 'NUMBER', description: 'ID of the supplier' },
          { name: 'TOTAL_AMOUNT', type: 'NUMBER', description: 'Total value of PO' },
          { name: 'CURRENCY', type: 'STRING', description: 'PO Currency code' }
        ]
      },
      {
        id: 'obj_po_line',
        name: 'PO Line',
        tableName: 'PO_LINES',
        fields: [
          { name: 'PO_LINE_ID', type: 'NUMBER', description: 'Line item unique ID' },
          { name: 'PO_HEADER_ID', type: 'NUMBER', description: 'Reference to header' },
          { name: 'ITEM_DESCRIPTION', type: 'STRING', description: 'Description of item ordered' },
          { name: 'QUANTITY', type: 'NUMBER', description: 'Quantity ordered' },
          { name: 'UNIT_PRICE', type: 'NUMBER', description: 'Price per unit' }
        ]
      }
    ],
    relationships: [
      { sourceObjectId: 'obj_po_head', targetObjectId: 'obj_po_line', joinType: 'INNER', condition: 'PO_HEADERS.PO_HEADER_ID = PO_LINES.PO_HEADER_ID' }
    ]
  }
];

export const Icons = {
  File: (props: any) => <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>,
  Settings: (props: any) => <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12a7.5 7.5 0 0 0 15 0m-15 0a7.5 7.5 0 1 1 15 0m-15 0H3m16.5 0H21m-1.5 0H12m-8.457 3.077 1.41-.513m14.095-5.13-1.41.513M5.106 17.785l1.15-.964m11.49-9.642-1.15.964M7.5 21a7.5 7.5 0 0 0 15 0m-15 0a7.5 7.5 0 1 1 15 0m-15 0H3m16.5 0H21m-1.5 0H12m-8.457 3.077 1.41-.513m14.095-5.13-1.41.513M5.106 17.785l1.15-.964m11.49-9.642-1.15.964M10.5 7.5h.008v.008H10.5V7.5Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" /></svg>,
  Play: (props: any) => <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" /></svg>,
  Plus: (props: any) => <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>,
  Upload: (props: any) => <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" /></svg>,
  Database: (props: any) => <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0v3.75" /></svg>,
  Brain: (props: any) => <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6c0-3.314-2.686-6-6-6s-6 2.686-6 6a6 6 0 0 0 6 6Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 2.25V4.5m0 15v2.25m9.75-9.75h-2.25M4.5 12H2.25m17.142-7.142l-1.591 1.591m-11.102 11.102l-1.591 1.591m14.284 0l-1.591-1.591M6.091 6.091L4.5 4.5" /></svg>,
  Download: (props: any) => <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>,
  Search: (props: any) => <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg>,
  X: (props: any) => <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>,
  Copy: (props: any) => <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" /></svg>,
};
