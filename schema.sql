-- Pharma Based Inventory Management System (MySQL 8.0.16+)
-- Run:  mysql -u root -p < schema.sql
DROP DATABASE IF EXISTS pharma_inventory;
CREATE DATABASE pharma_inventory CHARACTER SET utf8mb4;
USE pharma_inventory;

CREATE TABLE Supplier (
  supplier_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  contact_no VARCHAR(15),
  address VARCHAR(255),
  email VARCHAR(100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE Medicine (
  medicine_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50),
  manufacturer VARCHAR(100),
  unit_price DECIMAL(10,2) NOT NULL CHECK (unit_price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE PurchaseOrder (
  po_id INT AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT NOT NULL,
  order_date DATE NOT NULL,
  status ENUM('Pending','Received','Cancelled') DEFAULT 'Pending',
  FOREIGN KEY (supplier_id) REFERENCES Supplier(supplier_id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE PurchaseOrderItem (
  po_item_id INT AUTO_INCREMENT PRIMARY KEY,
  po_id INT NOT NULL,
  medicine_id INT NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  unit_cost DECIMAL(10,2) NOT NULL CHECK (unit_cost >= 0),
  FOREIGN KEY (po_id) REFERENCES PurchaseOrder(po_id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (medicine_id) REFERENCES Medicine(medicine_id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE Batch (
  batch_id INT AUTO_INCREMENT PRIMARY KEY,
  medicine_id INT NOT NULL,
  batch_no VARCHAR(50) NOT NULL,
  mfg_date DATE NOT NULL,
  expiry_date DATE NOT NULL,
  quantity INT NOT NULL CHECK (quantity >= 0),
  FOREIGN KEY (medicine_id) REFERENCES Medicine(medicine_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK (expiry_date > mfg_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE Customer (
  customer_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  contact_no VARCHAR(15),
  address VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE Employee (
  employee_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  role VARCHAR(50),
  contact_no VARCHAR(15)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE Sale (
  sale_id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  employee_id INT NOT NULL,
  sale_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  FOREIGN KEY (customer_id) REFERENCES Customer(customer_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES Employee(employee_id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE SaleItem (
  sale_item_id INT AUTO_INCREMENT PRIMARY KEY,
  sale_id INT NOT NULL,
  batch_id INT NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  unit_price DECIMAL(10,2) NOT NULL CHECK (unit_price >= 0),
  FOREIGN KEY (sale_id) REFERENCES Sale(sale_id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (batch_id) REFERENCES Batch(batch_id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Triggers: every sale line validates and deducts stock automatically.
DELIMITER $$
CREATE TRIGGER trg_saleitem_before BEFORE INSERT ON SaleItem
FOR EACH ROW
BEGIN
  DECLARE q INT; DECLARE exp DATE;
  SELECT quantity, expiry_date INTO q, exp FROM Batch WHERE batch_id = NEW.batch_id FOR UPDATE;
  IF exp <= CURDATE() THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Batch is expired and cannot be sold';
  END IF;
  IF q < NEW.quantity THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Insufficient stock in batch';
  END IF;
END$$

CREATE TRIGGER trg_saleitem_after AFTER INSERT ON SaleItem
FOR EACH ROW
BEGIN
  UPDATE Batch SET quantity = quantity - NEW.quantity WHERE batch_id = NEW.batch_id;
  UPDATE Sale SET total_amount = total_amount + NEW.quantity * NEW.unit_price WHERE sale_id = NEW.sale_id;
END$$
DELIMITER ;

-- Sample data
INSERT INTO Supplier (name, contact_no, address, email) VALUES
('MedPlus Distributors','9820011122','Andheri, Mumbai','sales@medplus.example'),
('HealthBridge Pharma','9833344455','Vashi, Navi Mumbai','orders@healthbridge.example');
INSERT INTO Medicine (name, category, manufacturer, unit_price) VALUES
('Paracetamol 500mg','Analgesic','Cipla',2.50),
('Amoxicillin 250mg','Antibiotic','Sun Pharma',8.00),
('Cetirizine 10mg','Antihistamine','Dr. Reddys',3.00),
('Metformin 500mg','Antidiabetic','Lupin',4.20),
('ORS Sachet','Rehydration','FDC',18.00);
INSERT INTO Batch (medicine_id, batch_no, mfg_date, expiry_date, quantity) VALUES
(1,'PCM-A1',CURDATE() - INTERVAL 300 DAY,CURDATE() + INTERVAL 45 DAY,120),
(1,'PCM-B2',CURDATE() - INTERVAL 60 DAY,CURDATE() + INTERVAL 600 DAY,400),
(2,'AMX-C1',CURDATE() - INTERVAL 100 DAY,CURDATE() + INTERVAL 400 DAY,40),
(3,'CET-D4',CURDATE() - INTERVAL 90 DAY,CURDATE() + INTERVAL 500 DAY,15),
(4,'MET-E7',CURDATE() - INTERVAL 30 DAY,CURDATE() + INTERVAL 700 DAY,250),
(5,'ORS-F2',CURDATE() - INTERVAL 200 DAY,CURDATE() + INTERVAL 20 DAY,60);
INSERT INTO Customer (name, contact_no, address) VALUES
('Walk-in Customer',NULL,NULL),('Ramesh Kulkarni','9876500011','Dadar, Mumbai');
INSERT INTO Employee (name, role, contact_no) VALUES
('Anita Desai','Pharmacist','9811122233'),('Vikram Rao','Admin','9822233344');
INSERT INTO PurchaseOrder (supplier_id, order_date, status) VALUES (1, CURDATE() - INTERVAL 20 DAY, 'Received');
INSERT INTO PurchaseOrderItem (po_id, medicine_id, quantity, unit_cost) VALUES (1,1,400,1.80),(1,4,250,3.10);
