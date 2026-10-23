// Thin HTTP adapter for the admin users API (design §7.2): parse the
// request, delegate to the service, serialize the response. No business
// logic here (§4.5). requireRole('admin') already ran in app.js (§6 step 9).
export function createAdminUserController({ service }) {
  return {
    async list(req, res) {
      res.status(200).json({ users: await service.list() });
    },

    async create(req, res) {
      const user = await service.createUser({
        body: req.body,
        actorId: req.user?.id ?? null,
      });
      res.status(201).json({ user });
    },

    async update(req, res) {
      const user = await service.updateUser({
        id: req.params.id,
        body: req.body,
        actorId: req.user?.id ?? null,
      });
      res.status(200).json({ user });
    },

    async resetPassword(req, res) {
      await service.resetPassword({ id: req.params.id, body: req.body });
      res.status(204).end();
    },
  };
}
