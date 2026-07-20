UPDATE `threads`
SET `visibility` = 'hidden'
WHERE `origin_kind` = 'side-chat'
   OR `child_origin` = 'side-chat';
