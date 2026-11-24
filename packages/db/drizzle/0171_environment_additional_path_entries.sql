UPDATE `environments` SET `additional_paths` = (
  SELECT json_group_array(json_object('path', `entry`.`value`, 'replaces', NULL) ORDER BY `entry`.`key`)
  FROM json_each(`environments`.`additional_paths`) AS `entry`
) WHERE `additional_paths` <> '[]';
