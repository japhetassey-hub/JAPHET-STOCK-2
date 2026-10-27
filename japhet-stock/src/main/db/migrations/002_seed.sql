INSERT INTO roles(name) VALUES ('Administrator'),('Manager'),('Storekeeper'),('Bar Staff'),('Kitchen Staff'),('Report Viewer');
-- Bootstrap admin: NO password yet. Phase 6 forces setting one on first launch.
INSERT INTO users(username, full_name, role_id, password_hash) VALUES ('admin','Administrator',1,NULL);
INSERT INTO locations(name, kind) VALUES ('Main Store','STORE'),('Bar Counter','BAR'),('Kitchen','KITCHEN'),
  ('Cocktail & Juice Station','COCKTAIL_JUICE'),('Cleaning Supplies Store','CLEANING');
INSERT INTO units(name,symbol,allows_decimals) VALUES
 ('Piece','pc',0),('Bottle','btl',0),('Can','can',0),('Crate','crate',0),('Carton','ctn',0),('Box','box',0),
 ('Packet','pkt',0),('Kilogram','kg',1),('Gram','g',1),('Litre','L',1),('Millilitre','mL',1),('Bag','bag',0),('Roll','roll',0);
INSERT INTO categories(name) VALUES ('Beverages'),('Kitchen'),('Cocktail and Juice'),('Cleaning and General Supplies');
INSERT INTO categories(name,parent_id) SELECT n,(SELECT id FROM categories WHERE name='Beverages' AND parent_id IS NULL) FROM
 (SELECT 'Beer' n UNION ALL SELECT 'Soft drinks' UNION ALL SELECT 'Water' UNION ALL SELECT 'Wine' UNION ALL SELECT 'Spirits' UNION ALL SELECT 'Mixers');
INSERT INTO categories(name,parent_id) SELECT n,(SELECT id FROM categories WHERE name='Kitchen' AND parent_id IS NULL) FROM
 (SELECT 'Meat' n UNION ALL SELECT 'Chicken' UNION ALL SELECT 'Fish' UNION ALL SELECT 'Vegetables' UNION ALL SELECT 'Fruits' UNION ALL SELECT 'Rice'
  UNION ALL SELECT 'Flour' UNION ALL SELECT 'Cooking oil' UNION ALL SELECT 'Spices' UNION ALL SELECT 'Sauces' UNION ALL SELECT 'Other ingredients');
INSERT INTO categories(name,parent_id) SELECT n,(SELECT id FROM categories WHERE name='Cocktail and Juice' AND parent_id IS NULL) FROM
 (SELECT 'Fresh fruits' n UNION ALL SELECT 'Juice' UNION ALL SELECT 'Syrups' UNION ALL SELECT 'Sugar' UNION ALL SELECT 'Milk' UNION ALL SELECT 'Water'
  UNION ALL SELECT 'Ice' UNION ALL SELECT 'Mixers' UNION ALL SELECT 'Garnishes');
INSERT INTO categories(name,parent_id) SELECT n,(SELECT id FROM categories WHERE name='Cleaning and General Supplies' AND parent_id IS NULL) FROM
 (SELECT 'Detergents' n UNION ALL SELECT 'Cleaning chemicals' UNION ALL SELECT 'Tissue' UNION ALL SELECT 'Hand soap' UNION ALL SELECT 'Garbage bags'
  UNION ALL SELECT 'Disposable items' UNION ALL SELECT 'Other operational supplies');
INSERT INTO settings(key,value) VALUES ('allow_negative_stock','0'),('currency','TZS'),('timezone','Africa/Dar_es_Salaam'),
  ('date_format','DD/MM/YYYY'),('language','en');
