export const getStatus = (req, res) => {
    res.status(200).json({
        status: 'online',
        message: 'API de QA operativa y lista para recibir órdenes.'
    })
}