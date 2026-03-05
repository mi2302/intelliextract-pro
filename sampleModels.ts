
export const SAMPLES = [
  {
    name: "E-commerce (SQL)",
    fileName: "ecommerce_complex_schema.sql",
    icon: "sql",
    content: `-- Primary Entities
CREATE TABLE Customers (
    CustomerID INT PRIMARY KEY,
    Email VARCHAR(100) UNIQUE,
    Status VARCHAR(20)
);

CREATE TABLE Orders (
    OrderID INT PRIMARY KEY,
    CustomerID INT,
    OrderDate DATETIME,
    FOREIGN KEY (CustomerID) REFERENCES Customers(CustomerID)
);

-- Many-to-Many Relationships
CREATE TABLE Products (
    ProductID INT PRIMARY KEY,
    SKU VARCHAR(50),
    BasePrice DECIMAL(10, 2)
);

CREATE TABLE OrderItems (
    ItemID INT PRIMARY KEY,
    OrderID INT,
    ProductID INT,
    Quantity INT,
    FOREIGN KEY (OrderID) REFERENCES Orders(OrderID),
    FOREIGN KEY (ProductID) REFERENCES Products(ProductID)
);

CREATE TABLE Categories (
    CategoryID INT PRIMARY KEY,
    CategoryName VARCHAR(50)
);

CREATE TABLE ProductCategories (
    ProductID INT,
    CategoryID INT,
    PRIMARY KEY (ProductID, CategoryID),
    FOREIGN KEY (ProductID) REFERENCES Products(ProductID),
    FOREIGN KEY (CategoryID) REFERENCES Categories(CategoryID)
);`
  },
  {
    name: "HR System (JSON)",
    fileName: "normalized_hr_data.json",
    icon: "json",
    content: `{
  "metadata": {
    "version": "2.0",
    "description": "Normalized Workforce Architecture"
  },
  "departments": [
    { "dept_id": "D101", "name": "Engineering", "budget": 500000 },
    { "dept_id": "D102", "name": "Marketing", "budget": 250000 }
  ],
  "employees": [
    { 
      "emp_id": "E001", 
      "name": "Alice Smith", 
      "fk_dept_id": "D101", 
      "role": "Architect"
    },
    { 
      "emp_id": "E002", 
      "name": "Bob Jones", 
      "fk_dept_id": "D101", 
      "role": "Developer"
    }
  ],
  "projects": [
    { "proj_id": "P55", "title": "Cloud Migration", "lead_emp_id": "E001" },
    { "proj_id": "P56", "title": "AI Integration", "lead_emp_id": "E002" }
  ]
}`
  },
  {
    name: "Logistics (CSV)",
    fileName: "fleet_management_relational.csv",
    icon: "csv",
    content: `# SECTION: Vehicles (Master)
PK_VehicleID,LicensePlate,Model,Year,Carrier_ID
V100,XYZ-1234,Freightliner,2022,C_FEDEX
V101,ABC-5678,Volvo VNL,2021,C_UPS
V102,LMN-9012,Peterbilt,2023,C_DHL

# SECTION: Maintenance_Logs (Transactional)
LogID,FK_VehicleID,ServiceDate,Cost,Status
LOG_001,V100,2024-01-15,450.00,Completed
LOG_002,V100,2024-05-20,1200.00,Completed
LOG_003,V101,2024-03-10,300.00,In_Progress

# SECTION: Carriers (Lookup)
CarrierID,FullName,ContactEmail,Rating
C_FEDEX,Federal Express,ops@fedex.com,4.8
C_UPS,United Parcel Service,support@ups.com,4.7
C_DHL,DHL Express,global@dhl.com,4.9`
  },
  {
    name: "Workforce Management (CSV)",
    fileName: "workforce_management_template.csv",
    icon: "csv",
    content: `Module: Workforce Management

# SECTION: MSAI_HR_EMPLOYEE_MASTER
EMP_ID,FIRST_NAME,LAST_NAME,EMAIL,HIRE_DATE
1001,John,Doe,john.doe@company.com,2023-01-15
1002,Jane,Smith,jane.smith@company.com,2023-02-20
1003,Robert,Brown,robert.brown@company.com,2023-03-10`
  }
];
