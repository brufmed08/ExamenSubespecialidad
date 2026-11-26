-- Elimina al alumno de prueba que quedó registrado (usuario 00001) junto con su examen, firmas,
-- incidencias, sesiones, avisos y el acta de Neonatología que lo incluía, y deja un sustentante
-- de prueba (usuario: prueba) marcado como eliminable por el coordinador.
DELETE FROM records WHERE collection = 'notifications'
  AND (data->>'intento' IN (SELECT r.id FROM records r JOIN records u ON u.collection = 'users' AND u.id = r.data->>'userId'
        WHERE r.collection = 'attempts' AND u.data->>'usuario' = '00001' AND u.data->>'rol' = 'alumno')
    OR (data->>'folio' = '00001' AND data->>'tipo' IN ('temario', 'resultado', 'resultado_alumno')));
--> statement-breakpoint
DELETE FROM records WHERE collection IN ('attempts', 'consents', 'incidents', 'sessions')
  AND data->>'userId' IN (SELECT id FROM records WHERE collection = 'users' AND data->>'usuario' = '00001' AND data->>'rol' = 'alumno');
--> statement-breakpoint
DELETE FROM records WHERE collection = 'actas_emitidas' AND data->>'folio' = 'ACT-NEONAT-2026-0001';
--> statement-breakpoint
DELETE FROM records WHERE collection = 'counters' AND id = 'F_acta_neonatologia_2026' AND (data->>'n')::int = 1;
--> statement-breakpoint
DELETE FROM records WHERE collection = 'users' AND data->>'usuario' = '00001' AND data->>'rol' = 'alumno';
--> statement-breakpoint
INSERT INTO records (collection, id, data, updated_at)
SELECT 'users', 'u_prueba000001', '{"id":"u_prueba000001","usuario":"prueba","rol":"alumno","nombre":"SUSTENTANTE","apellidos":"DE PRUEBA","email":"sustentante.prueba@ejemplo.com","whatsapp":"","matricula":"PRUEBA-01","especialidad":"neonatologia","activo":true,"prueba":true,"creado":1795736601564,"fallos":0,"salt":"6ce6858c8a96d9d6e22d07c0","hash":"fff3617d12953eb4039136af21d0e8c0f47a92c507551a01732eca9fd1bea73d"}'::jsonb, now()
WHERE NOT EXISTS (SELECT 1 FROM records WHERE collection = 'users' AND data->>'usuario' = 'prueba');
